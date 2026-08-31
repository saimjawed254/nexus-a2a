import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { SessionManager } from '../services/session-manager';
import { InventoryManager } from '../services/inventory-manager';

export const adminRouter = Router();

// Middleware to check Merchant API Key for Admin Routes
adminRouter.use((req, res, next) => {
  const merchantKey = req.headers['x-merchant-key'];
  if (merchantKey !== process.env.MERCHANT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid merchant API key' });
  }
  next();
});

// Phase 7: Live Monitor Kill Switch
adminRouter.post('/terminate/:session_id', async (req: Request, res: Response) => {
  const session_id = req.params.session_id as string;
  const { reason = 'TERMINATED_BY_MERCHANT' } = req.body;

  try {
    const session = await SessionManager.getSession(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'COMPLETED' || session.status === 'TERMINATED') {
      return res.status(400).json({ error: `Cannot terminate a ${session.status} session` });
    }

    // Terminate session and release stock
    await SessionManager.terminateSession(session_id, reason);
    await InventoryManager.releaseAllocation(session_id);
    await SessionManager.logMessage(session_id, 'SYSTEM', `MERCHANT TRIGGERED KILL SWITCH: ${reason}`);

    res.json({ success: true, message: 'Session forcefully terminated and stock released.' });
  } catch (error: any) {
    console.error("Kill switch error:", error);
    res.status(500).json({ error: 'Failed to terminate session' });
  }
});

// Phase 8: Manual Review Workflow - Approve
adminRouter.post('/review/:session_id/approve', async (req: Request, res: Response) => {
  const session_id = req.params.session_id as string;
  try {
    const session = await SessionManager.getSession(session_id);
    if (!session || session.status !== 'PENDING_MERCHANT_REVIEW') {
      return res.status(400).json({ error: 'Session is not pending review' });
    }

    await pool.query(`UPDATE sessions SET status = 'APPROVED' WHERE id = $1`, [session_id]);
    await SessionManager.logMessage(session_id, 'MERCHANT', `Deal Approved. Generating payment link.`);

    res.json({ success: true, message: 'Session approved.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to approve session' });
  }
});

// Phase 8: Manual Review Workflow - Reject/Counter
adminRouter.post('/review/:session_id/reject', async (req: Request, res: Response) => {
  const session_id = req.params.session_id as string;
  const { counter_offer, message } = req.body;

  try {
    const session = await SessionManager.getSession(session_id);
    if (!session || session.status !== 'PENDING_MERCHANT_REVIEW') {
      return res.status(400).json({ error: 'Session is not pending review' });
    }

    if (counter_offer) {
      // Re-activate session with counter offer
      await pool.query(`UPDATE sessions SET status = 'ACTIVE' WHERE id = $1`, [session_id]);
      await SessionManager.logMessage(session_id, 'MERCHANT', message || `The merchant has countered with ₹${counter_offer}.`, { counter_offer });
      res.json({ success: true, status: 'ACTIVE', message: 'Counter offer sent.' });
    } else {
      // Hard Reject
      await SessionManager.terminateSession(session_id, 'REJECTED_BY_MERCHANT');
      await InventoryManager.releaseAllocation(session_id);
      await SessionManager.logMessage(session_id, 'MERCHANT', message || 'The merchant has rejected the deal.');
      res.json({ success: true, status: 'TERMINATED', message: 'Deal rejected and stock released.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to process rejection' });
  }
});

// Admin Route to view sessions with optional status filter
adminRouter.get('/sessions', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM sessions';
    const params: any[] = [];
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const result = await pool.query(query, params);
    res.json({ sessions: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Admin Route to fetch messages for a specific session (for live monitor polling)
adminRouter.get('/sessions/:session_id/messages', async (req: Request, res: Response) => {
  const session_id = req.params.session_id as string;
  try {
    const result = await pool.query(
      `SELECT role, content, metadata, created_at FROM session_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [session_id]
    );
    res.json({ messages: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});
