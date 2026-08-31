import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/client';
import { createOrder } from '../services/razorpay';
import { SessionManager } from '../services/session-manager';
import { InventoryManager } from '../services/inventory-manager';
import { env } from '../config/env';

export const checkoutRouter = Router();

// POST /api/checkout/create-order
// Called by frontend after merchant approves the deal
checkoutRouter.post('/create-order', async (req: Request, res: Response) => {
  const { session_id, customer_phone, shipping_address } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  try {
    const session = await SessionManager.getSession(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'APPROVED') {
      return res.status(403).json({ error: `Cannot checkout session with status: ${session.status}. Must be APPROVED.` });
    }

    // Fetch the final agreed price from the last AGENT message that has a finalOffer
    const lastOffer = await pool.query(`
      SELECT metadata->>'finalOffer' as final_price
      FROM session_messages
      WHERE session_id = $1 AND role = 'AGENT' AND metadata->>'finalOffer' IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [session_id]);

    if (lastOffer.rows.length === 0) {
      return res.status(400).json({ error: 'No agreed price found in session history' });
    }

    const finalPriceRupees = parseFloat(lastOffer.rows[0].final_price);
    const amountInPaise = Math.round(finalPriceRupees * 100);

    // Create Razorpay Order
    const order = await createOrder(amountInPaise, session_id);

    // Record in DB
    await pool.query(`
      INSERT INTO razorpay_orders (session_id, razorpay_order_id, amount_paise, currency, customer_phone, shipping_address)
      VALUES ($1, $2, $3, 'INR', $4, $5)
    `, [session_id, order.id, amountInPaise, customer_phone || null, shipping_address || null]);

    await SessionManager.logMessage(session_id, 'SYSTEM', `Razorpay order created: ${order.id}`, { order_id: order.id, amount_paise: amountInPaise });

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: env.RAZORPAY_KEY_ID,
      session_id
    });
  } catch (error: any) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create Razorpay order', details: error.message });
  }
});

// POST /api/checkout/verify-payment
// Called by frontend after Razorpay payment modal completes
checkoutRouter.post('/verify-payment', async (req: Request, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, session_id } = req.body;

  // Verify signature (HMAC-SHA256 verification)
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Payment signature mismatch. Possible fraud attempt.' });
  }

  try {
    // Signature is valid - update payment status and hard deduct stock
    await pool.query(
      `UPDATE razorpay_orders SET status = 'PAID' WHERE razorpay_order_id = $1`,
      [razorpay_order_id]
    );

    // Hard deduct from inventory (the final irrevocable action)
    await InventoryManager.hardDeduct(session_id);

    // Update cart items with final price
    const orderRes = await pool.query(
      'SELECT amount_paise FROM razorpay_orders WHERE razorpay_order_id = $1', 
      [razorpay_order_id]
    );
    const finalPriceRupees = orderRes.rows[0]?.amount_paise / 100;
    
    // Mark session as completed
    await pool.query(`UPDATE sessions SET status = 'COMPLETED' WHERE id = $1`, [session_id]);
    await SessionManager.logMessage(session_id, 'SYSTEM', `PAYMENT CONFIRMED: ${razorpay_payment_id}`, { 
      payment_id: razorpay_payment_id,
      order_id: razorpay_order_id,
      final_price: finalPriceRupees 
    });

    const io = (req as any).io;
    if (io) {
      io.to('merchant_monitor').emit('payment_confirmed', { session_id, payment_id: razorpay_payment_id });
    }

    res.json({ success: true, payment_id: razorpay_payment_id });
  } catch (error: any) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: 'Payment verified but post-processing failed', details: error.message });
  }
});
