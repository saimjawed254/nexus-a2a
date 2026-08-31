import fs from 'fs';
import path from 'path';
import { pool } from '../src/db/client';

async function migrate() {
  try {
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    console.log("Dropping existing tables to apply fresh schema...");
    await pool.query('DROP TABLE IF EXISTS razorpay_orders CASCADE');
    await pool.query('DROP TABLE IF EXISTS cart_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS session_messages CASCADE');
    await pool.query('DROP TABLE IF EXISTS sessions CASCADE');
    await pool.query('DROP TABLE IF EXISTS products CASCADE');
    await pool.query('DROP TABLE IF EXISTS merchant_config CASCADE');

    console.log("Applying schema...");
    await pool.query(schema);
    console.log("✅ Schema applied successfully!");
  } catch (error) {
    console.error("❌ Failed to apply schema:", error);
  } finally {
    await pool.end();
  }
}

migrate();
