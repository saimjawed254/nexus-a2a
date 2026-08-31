import { pool } from '../db/client';

export class SessionManager {
  static async createSession(buyerType: 'HUMAN' | 'AGENT', timeoutMinutes: number = 15, clerkUserId?: string): Promise<string> {
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
    const res = await pool.query(
      `INSERT INTO sessions (buyer_type, expires_at, status, clerk_user_id) VALUES ($1, $2, 'ACTIVE', $3) RETURNING id`,
      [buyerType, expiresAt, clerkUserId || null]
    );
    return res.rows[0].id;
  }

  static async getSession(sessionId: string) {
    const res = await pool.query(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
    return res.rows[0];
  }

  static async getSessionMessages(sessionId: string) {
    const res = await pool.query(`SELECT role, content, metadata FROM session_messages WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]);
    return res.rows.map(r => ({
      role: r.role,
      content: r.content,
      final_price: r.metadata?.finalOffer || null
    }));
  }

  static async logMessage(sessionId: string, role: 'USER' | 'AGENT' | 'SYSTEM' | 'MERCHANT', content: string, metadata?: any) {
    await pool.query(
      `INSERT INTO session_messages (session_id, role, content, metadata) VALUES ($1, $2, $3, $4)`,
      [sessionId, role, content, metadata ? JSON.stringify(metadata) : null]
    );
  }

  static async incrementRound(sessionId: string): Promise<number> {
    const res = await pool.query(`
      UPDATE sessions 
      SET rounds_used = rounds_used + 1 
      WHERE id = $1 
      RETURNING rounds_used
    `, [sessionId]);
    return res.rows[0].rounds_used;
  }

  static async terminateSession(sessionId: string, reason: string) {
    await pool.query(
      `UPDATE sessions SET status = 'TERMINATED', terminated_reason = $2 WHERE id = $1`,
      [sessionId, reason]
    );
  }
}
