import { Request, Response, NextFunction } from 'express';
import { SessionManager } from '../services/session-manager';

export const sessionGuard = async (req: Request, res: Response, next: NextFunction) => {
  const sessionId = req.headers['x-session-id'] as string;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'x-session-id header is required' });
  }

  try {
    const session = await SessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'ACTIVE') {
      return res.status(403).json({ error: `Session is ${session.status}` });
    }

    if (new Date() > new Date(session.expires_at)) {
      await SessionManager.terminateSession(sessionId, 'TIMEOUT');
      return res.status(403).json({ error: 'Session has expired' });
    }

    // Attach session to request for downstream handlers
    (req as any).session = session;
    next();
  } catch (error) {
    console.error("Session Guard Error:", error);
    res.status(500).json({ error: 'Internal server error validating session' });
  }
};
