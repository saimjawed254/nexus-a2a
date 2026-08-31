import { pool } from '../db/client';

interface CartItem {
  product_id: string;
  quantity: number;
}

interface ProductRule {
  max_discount_pct: number;
  volume_tiers?: Array<{ min_qty: number; max_discount_pct: number }>;
}

/**
 * Calculates the absolute maximum discount allowed for a given cart,
 * enforcing all global and product-specific rules deterministically.
 */
export async function calculateCeiling(cart: CartItem[]): Promise<{ ceiling_amount: number, total_value: number }> {
  // Fetch global config
  const configRes = await pool.query('SELECT max_discount_pct FROM merchant_config LIMIT 1');
  const globalMaxPct = configRes.rows.length > 0 ? configRes.rows[0].max_discount_pct : 3.0;

  let totalValue = 0;
  let maxAllowedDiscountAmount = 0;

  for (const item of cart) {
    const productRes = await pool.query('SELECT price, parsed_rules FROM products WHERE id = $1', [item.product_id]);
    if (productRes.rows.length === 0) continue;

    const product = productRes.rows[0];
    const price = parseFloat(product.price);
    const itemTotalValue = price * item.quantity;
    
    totalValue += itemTotalValue;

    // Determine the max discount percentage for this specific item
    let itemMaxPct = globalMaxPct;
    
    if (product.parsed_rules) {
      const rules = product.parsed_rules as ProductRule;
      
      // Volume tiers override the base product max discount if applicable
      if (rules.volume_tiers && rules.volume_tiers.length > 0) {
        // Sort descending by min_qty to find the highest applicable tier
        const sortedTiers = [...rules.volume_tiers].sort((a, b) => b.min_qty - a.min_qty);
        const applicableTier = sortedTiers.find(t => item.quantity >= t.min_qty);
        
        if (applicableTier) {
          itemMaxPct = applicableTier.max_discount_pct;
        } else if (rules.max_discount_pct !== undefined) {
           itemMaxPct = rules.max_discount_pct;
        }
      } else if (rules.max_discount_pct !== undefined) {
        itemMaxPct = rules.max_discount_pct;
      }
    }

    const itemMaxDiscount = itemTotalValue * (itemMaxPct / 100);
    maxAllowedDiscountAmount += itemMaxDiscount;
  }

  // To prevent floating point inaccuracies from rounding up slightly
  const safeCeilingAmount = Math.floor(maxAllowedDiscountAmount * 100) / 100;

  return { 
    ceiling_amount: safeCeilingAmount,
    total_value: totalValue
  };
}
