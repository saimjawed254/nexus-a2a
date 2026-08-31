import { pool } from '../src/db/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function resetDemo() {
  console.log('🗑️  Resetting demo data...');
  
  try {
    // Release all allocations first
    const activeSessions = await pool.query(`SELECT id FROM sessions WHERE status IN ('ACTIVE', 'PENDING_MERCHANT_REVIEW')`);
    for (const session of activeSessions.rows) {
      const cartItems = await pool.query('SELECT product_id, quantity FROM cart_items WHERE session_id = $1', [session.id]);
      for (const item of cartItems.rows) {
        await pool.query('UPDATE products SET allocated_stock = GREATEST(0, allocated_stock - $1) WHERE id = $2', [item.quantity, item.product_id]);
      }
    }

    // Clear transactional data (preserve products & config)
    await pool.query('DELETE FROM razorpay_orders');
    await pool.query('DELETE FROM session_messages');
    await pool.query('DELETE FROM cart_items');
    await pool.query('DELETE FROM sessions');

    console.log('✅ Demo reset complete! Products and config preserved.');
    console.log('   Ready for a clean pitch demo.');
  } catch (e: any) {
    console.error('❌ Reset failed:', e.message);
  } finally {
    await pool.end();
  }
}

resetDemo();
