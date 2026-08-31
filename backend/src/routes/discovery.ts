import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { geminiPro, generateEmbedding } from '../services/gemini';

export const discoveryRouter = Router();

interface HardFilters {
  price_max?: number;
  keyword?: string; // typically brand or model
}

async function extractFilters(query: string): Promise<HardFilters> {
  const prompt = `
SYSTEM: You are a search intent parser for a tech store.
Extract any hard filters from the user's query into EXACTLY this JSON format.
Do not add fields. Only return valid JSON. If no filter is found, omit the field.
Schema: {
  "price_max": number // e.g., "under 80k" -> 80000
}
User Query: "${query}"
`;
  try {
    const response = await geminiPro.generateContent(prompt);
    let text = response.response.text().trim();
    if (text.startsWith('\`\`\`json')) {
      text = text.substring(7, text.length - 3).trim();
    } else if (text.startsWith('\`\`\`')) {
      text = text.substring(3, text.length - 3).trim();
    }
    return JSON.parse(text) as HardFilters;
  } catch (e) {
    console.error("Filter extraction failed:", e);
    return {};
  }
}

discoveryRouter.post('/discover', async (req: Request, res: Response) => {
  try {
    const { query, page = 1, limit = 20 } = req.body;
    const offset = (page - 1) * limit;
    
    // If empty query (e.g. initial load), return newest products with pagination
    if (!query) {
      const result = await pool.query(`
        SELECT id, name, brand, model, category, description, specs, price, (stock - allocated_stock) as available_stock
        FROM products
        WHERE (stock - allocated_stock) > 0
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);
      
      const countResult = await pool.query(`SELECT COUNT(*) FROM products WHERE (stock - allocated_stock) > 0`);
      const total = parseInt(countResult.rows[0].count, 10);
      
      return res.json({
        products: result.rows,
        total,
        page,
        total_pages: Math.ceil(total / limit),
        query_metadata: {
          semantic_score_max: 1,
          hard_filters_applied: false,
          extracted_filters: {}
        }
      });
    }

    // Extract hard filters
    const filters = await extractFilters(query);
    const hasFilters = Object.keys(filters).length > 0;

    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build Hybrid SQL Query
    // We order by vector distance (cosine) and apply hard SQL filters
    let sql = `
      SELECT id, name, brand, model, category, description, specs, price, (stock - allocated_stock) as available_stock,
             1 - (embedding <=> $1::vector) AS semantic_score
      FROM products
      WHERE (stock - allocated_stock) > 0
    `;
    const params: any[] = [embeddingStr];
    let paramIndex = 2;

    if (filters.price_max) {
      sql += ` AND price <= $${paramIndex}`;
      params.push(filters.price_max);
      paramIndex++;
    }



    // Apply Pagination to semantic search
    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(sql, params);

    // Filter out results with very low semantic scores unless it's a pure keyword match
    const products = result.rows.map(row => {
      // Don't send embedding back to client
      const { semantic_score, ...rest } = row;
      return rest;
    });

    res.json({
      products,
      page,
      limit,
      query_metadata: {
        semantic_score_max: result.rows.length > 0 ? result.rows[0].semantic_score : 0,
        hard_filters_applied: hasFilters,
        extracted_filters: filters
      }
    });

  } catch (error: any) {
    console.error('Discovery error:', error);
    res.status(500).json({ error: 'Discovery failed', details: error.message });
  }
});
