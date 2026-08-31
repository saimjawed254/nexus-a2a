import { pool } from '../db/client';

interface CartItem {
  product_id: string;
  quantity: number;
}

export class InventoryManager {
  /**
   * Checks if sufficient stock is available without allocating it.
   */
  static async checkAvailability(cartItems: CartItem[]): Promise<boolean> {
    const client = await pool.connect();
    try {
      for (const item of cartItems) {
        const res = await client.query(`
          SELECT id, name FROM products 
          WHERE id = $1 AND (stock - allocated_stock) >= $2
        `, [item.product_id, item.quantity]);
        
        if (res.rows.length === 0) {
          const nameRes = await client.query('SELECT name FROM products WHERE id = $1', [item.product_id]);
          const pName = nameRes.rows.length > 0 ? nameRes.rows[0].name : item.product_id;
          throw new Error(JSON.stringify({ 
            message: `Insufficient stock for: ${pName}`, 
            product_id: item.product_id 
          }));
        }
      }
      return true;
    } finally {
      client.release();
    }
  }

  /**
   * Soft allocates stock for a session.
   * Throws an error if there is insufficient available stock (stock - allocated_stock).
   */
  static async softAllocate(sessionId: string, cartItems: CartItem[]): Promise<boolean> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const item of cartItems) {
        // Atomic check and update using a subquery and row lock
        const res = await client.query(`
          UPDATE products 
          SET allocated_stock = allocated_stock + $1 
          WHERE id = $2 AND (stock - allocated_stock) >= $1
          RETURNING id, name;
        `, [item.quantity, item.product_id]);
        
        if (res.rowCount === 0) {
          const nameRes = await client.query('SELECT name FROM products WHERE id = $1', [item.product_id]);
          const pName = nameRes.rows.length > 0 ? nameRes.rows[0].name : item.product_id;
          throw new Error(JSON.stringify({ 
            message: `Insufficient stock for: ${pName}`, 
            product_id: item.product_id 
          }));
        }
        // NOTE: cart_items are inserted by the caller (negotiation route), NOT here.
      }

      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Releases allocated stock back to available pool.
   * Used when a session times out, is terminated, or user cancels.
   */
  static async releaseAllocation(sessionId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const cartItems = await client.query('SELECT product_id, quantity FROM cart_items WHERE session_id = $1', [sessionId]);
      
      for (const item of cartItems.rows) {
        await client.query(`
          UPDATE products 
          SET allocated_stock = allocated_stock - $1 
          WHERE id = $2
        `, [item.quantity, item.product_id]);
      }

      // We do not delete cart_items as they act as a historical record of the session, 
      // but they are now considered inactive because the session status will be updated to TERMINATED.
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error("Failed to release allocation for session", sessionId, e);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Hard deducts the stock. Called strictly ONLY AFTER Razorpay webhook confirms 'PAID'.
   */
  static async hardDeduct(sessionId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const cartItems = await client.query('SELECT product_id, quantity FROM cart_items WHERE session_id = $1', [sessionId]);
      
      for (const item of cartItems.rows) {
        await client.query(`
          UPDATE products 
          SET 
            stock = stock - $1,
            allocated_stock = allocated_stock - $1
          WHERE id = $2
        `, [item.quantity, item.product_id]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error("Failed to hard deduct stock for session", sessionId, e);
      throw e;
    } finally {
      client.release();
    }
  }
}
