import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { pool } from './db/client';
import { merchantRouter } from './routes/merchant';
import { discoveryRouter } from './routes/discovery';
import { negotiationRouter } from './routes/negotiation';
import { adminRouter } from './routes/admin';
import { checkoutRouter } from './routes/checkout';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Inject io into req for routes to emit events
app.use((req, res, next) => {
  (req as any).io = io;
  next();
});

// Socket.io connection logic for Live Monitor
io.on('connection', (socket) => {
  console.log('Merchant Monitor Connected:', socket.id);
  socket.on('join_monitor', () => {
    socket.join('merchant_monitor');
  });
});

// Health Check with DB ping
app.get('/health', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT NOW()');
    res.status(200).json({ 
      status: 'ok', 
      db: 'connected', 
      time: dbRes.rows[0].now 
    });
  } catch (error) {
    console.error('Health check DB error:', error);
    res.status(500).json({ 
      status: 'error', 
      db: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API Routes
app.use('/api/merchant', merchantRouter);
app.use('/api/discovery', discoveryRouter);
app.use('/api/negotiation', negotiationRouter);
app.use('/api/admin', adminRouter);
app.use('/api/checkout', checkoutRouter);

server.listen(env.PORT, () => {
  console.log(`🚀 Nexus Backend running on http://localhost:${env.PORT}`);
});
