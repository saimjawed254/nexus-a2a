import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { processAndUpsertProduct, RawProduct } from '../services/auto-vectorizer';
import { pool } from '../db/client';

export const merchantRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

merchantRouter.post('/upload-catalog', upload.single('catalog'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No catalog file provided' });
  }

  const csvData = req.file.buffer.toString('utf-8');
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Fetch current config for fallback discount
  const configRes = await pool.query('SELECT max_discount_pct FROM merchant_config LIMIT 1');
  const fallbackDiscount = configRes.rows.length > 0 ? configRes.rows[0].max_discount_pct : 3.0;

  parse(csvData, { columns: true, skip_empty_lines: true }, async (err, records: any[]) => {
    if (err) {
      return res.status(400).json({ error: 'Failed to parse CSV', details: err.message });
    }

    // Process sequentially to avoid hitting Gemini rate limits on the free tier
    for (const record of records) {
      try {
        const product: RawProduct = {
          name: record.name,
          brand: record.brand,
          model: record.model,
          category: record.category,
          description: record.description,
          specs: record.specs_json ? JSON.parse(record.specs_json) : {},
          price: parseFloat(record.price),
          stock: parseInt(record.stock, 10),
          unstructured_rules: record.unstructured_rules || undefined
        };

        await processAndUpsertProduct(product, fallbackDiscount);
        processed++;
      } catch (e: any) {
        failed++;
        errors.push(`Row ${record.name || 'unknown'}: ${e.message}`);
      }
    }

    res.json({ processed, failed, errors });
  });
});

merchantRouter.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ products: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch products', details: error.message });
  }
});

merchantRouter.get('/config', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM merchant_config LIMIT 1');
    if (result.rows.length === 0) return res.json({ max_rounds: 3, max_discount_pct: 3.0, llm_personality: 'STRICT', require_manual_approval: true, session_timeout_minutes: 15 });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

merchantRouter.put('/config', async (req, res) => {
  try {
    const { max_discount_pct, max_rounds, llm_personality, require_manual_approval, session_timeout_minutes } = req.body;
    
    // Using a simplistic UPDATE for the config since we assume only 1 row exists.
    const query = `
      UPDATE merchant_config 
      SET 
        max_discount_pct = COALESCE($1, max_discount_pct),
        max_rounds = COALESCE($2, max_rounds),
        llm_personality = COALESCE($3, llm_personality),
        require_manual_approval = COALESCE($4, require_manual_approval),
        session_timeout_minutes = COALESCE($5, session_timeout_minutes),
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [max_discount_pct, max_rounds, llm_personality, require_manual_approval, session_timeout_minutes];
    let result = await pool.query(query, values);

    if (result.rowCount === 0) {
      // If table is empty, insert default
      result = await pool.query(`
        INSERT INTO merchant_config (max_discount_pct, max_rounds, llm_personality, require_manual_approval, session_timeout_minutes)
        VALUES ($1, $2, $3, $4, $5) RETURNING *;
      `, values);
    }
    
    res.json({ config: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update config', details: error.message });
  }
});
