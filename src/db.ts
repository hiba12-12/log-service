import { Pool } from 'pg';
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  }
}