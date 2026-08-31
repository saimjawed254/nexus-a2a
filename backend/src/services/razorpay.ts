import Razorpay from 'razorpay';
import { env } from '../config/env';

export const razorpayClient = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export async function createOrder(amountInPaise: number, sessionId: string): Promise<{ id: string; amount: number; currency: string }> {
  const order = await razorpayClient.orders.create({
    amount: Math.round(amountInPaise),
    currency: 'INR',
    receipt: `nexus_${sessionId.substring(0, 20)}`,
    notes: {
      session_id: sessionId,
      platform: 'Nexus Negotiation Engine'
    }
  });
  return { id: order.id as string, amount: order.amount as number, currency: order.currency };
}
