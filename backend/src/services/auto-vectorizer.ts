import { pool } from '../db/client';
import { geminiPro, generateEmbedding } from './gemini';

export interface RawProduct {
  name: string;
  brand: string;
  model: string;
  category: string;
  description: string;
  specs: any;
  price: number;
  stock: number;
  unstructured_rules?: string;
}

export async function processAndUpsertProduct(product: RawProduct, fallbackDiscountPct: number) {
  // Compile rules via Gemini if unstructured rules exist
  let parsedRules = { 
    max_discount_pct: fallbackDiscountPct, 
    volume_tiers: [], 
    notes: "Universal merchant rule applied." 
  };

  if (product.unstructured_rules && product.unstructured_rules.trim().length > 0) {
    const prompt = `
SYSTEM: You are a JSON compiler. Parse the following merchant text into EXACTLY this JSON schema.
Do not add fields. Do not explain. Only return valid JSON without markdown block wrappers.
Schema: {
  "volume_tiers": [                    
    { "min_qty": number, "max_discount_pct": number }
  ],
  "max_discount_pct": number,          
  "notes": string                      
}
Rules: [${product.unstructured_rules}]
`;
    try {
      const response = await geminiPro.generateContent(prompt);
      let text = response.response.text().trim();
      if (text.startsWith('\`\`\`json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('\`\`\`')) {
        text = text.substring(3, text.length - 3).trim();
      }
      parsedRules = JSON.parse(text);
    } catch (e) {
      console.error(`Failed to parse rules for product ${product.name}. Falling back to universal rule.`, e);
    }
  }

  // Build Rich Text Document (Order is crucial for embedding weights)
  const specsString = typeof product.specs === 'object' ? JSON.stringify(product.specs) : product.specs;
  const richTextDoc = `BRAND: ${product.brand}. MODEL: ${product.model}. CATEGORY: ${product.category}.
PRICE: ₹${product.price}. STOCK AVAILABLE: ${product.stock} units.
KEY SPECIFICATIONS: ${specsString}.
DESCRIPTION: ${product.description}.`;

  // Generate Embedding
  const embedding = await generateEmbedding(richTextDoc);
  
  // Format embedding for pgvector (pg handles string format '[1,2,3]')
  const embeddingStr = `[${embedding.join(',')}]`;

  // Upsert into Neon DB
  const query = `
    INSERT INTO products (name, brand, model, category, description, specs, price, stock, unstructured_rules, parsed_rules, embedding)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id;
  `;
  const values = [
    product.name,
    product.brand,
    product.model,
    product.category,
    product.description,
    product.specs,
    product.price,
    product.stock,
    product.unstructured_rules || null,
    JSON.stringify(parsedRules),
    embeddingStr
  ];

  const result = await pool.query(query, values);
  return result.rows[0].id;
}
