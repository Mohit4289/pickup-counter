import { Pool, PoolClient } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl
});

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
  const result = await pool.query(text, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount ?? 0
  };
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
