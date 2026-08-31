import { Pool } from 'pg';
import { env } from '../config/env';

// Neon provides connection pooling, but using pg Pool is good practice.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

export const query = async (text: string, params?: any[]) => {
  return await pool.query(text, params);
};
