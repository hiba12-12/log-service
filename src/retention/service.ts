import { pool } from '../db';

const BATCH_SIZE = 1000;

const BATCH_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runRetentionCleanup(retentionDays: number): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const result = await pool.query(
      `
      DELETE FROM logs
      WHERE id IN (
        SELECT id FROM logs
        WHERE timestamp < now() - ($1 || ' days')::interval
        LIMIT $2
      )
      `,
      [retentionDays, BATCH_SIZE]
    );

    const deletedInBatch = result.rowCount ?? 0;
    totalDeleted += deletedInBatch;

    if (deletedInBatch < BATCH_SIZE) {
      break;
    }

    await sleep(BATCH_DELAY_MS);
  }

  return totalDeleted;
}