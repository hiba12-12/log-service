import 'dotenv/config';
import { pool } from '../src/db';
const TOTAL_ROWS = 1_000_000;
const BATCH_SIZE = 5000;
const CONCURRENCY = 5;

const SERVICES = ['checkout', 'auth', 'inventory', 'payments', 'shipping', 'notifications'];
const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_WEIGHTS = [0.3, 0.5, 0.15, 0.05]; 
const MESSAGES = [
  'request processed successfully',
  'payment declined',
  'user authenticated',
  'inventory updated',
  'shipment created',
  'connection timeout',
  'retry attempt failed',
  'cache miss',
  'rate limit exceeded',
  'database query slow',
];
const REGIONS = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-south'];

function pickWeighted(arr: string[], weights: number[]): string {
  const r = Math.random();
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += weights[i];
    if (r <= sum) return arr[i];
  }
  return arr[arr.length - 1];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTimestamp(): string {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return new Date(now - Math.random() * thirtyDaysMs).toISOString();
}

function buildBatch(size: number) {
  const timestamps: string[] = [];
  const levels: string[] = [];
  const services: string[] = [];
  const messages: string[] = [];
  const attributes: string[] = [];

  for (let i = 0; i < size; i++) {
    timestamps.push(randomTimestamp());
    levels.push(pickWeighted(LEVELS, LEVEL_WEIGHTS));
    services.push(pick(SERVICES));
    messages.push(pick(MESSAGES));
    attributes.push(
      JSON.stringify({
        user_id: String(Math.floor(Math.random() * 100000)),
        region: pick(REGIONS),
        request_id: Math.random().toString(36).slice(2),
      })
    );
  }

  return { timestamps, levels, services, messages, attributes };
}

async function insertBatch(size: number) {
  const { timestamps, levels, services, messages, attributes } = buildBatch(size);
  await pool.query(
    `INSERT INTO logs (timestamp, level, service, message, attributes)
     SELECT * FROM UNNEST($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[])`,
    [timestamps, levels, services, messages, attributes]
  );
}

async function main() {
  console.log(`Seeding ${TOTAL_ROWS.toLocaleString()} rows in batches of ${BATCH_SIZE}...`);
  const totalBatches = Math.ceil(TOTAL_ROWS / BATCH_SIZE);
  let completed = 0;
  const start = Date.now();

  let nextBatch = 0;
  async function worker() {
    while (nextBatch < totalBatches) {
      const myBatch = nextBatch++;
      const remaining = TOTAL_ROWS - myBatch * BATCH_SIZE;
      const size = Math.min(BATCH_SIZE, remaining);
      await insertBatch(size);
      completed++;
      if (completed % 10 === 0 || completed === totalBatches) {
        const elapsed = (Date.now() - start) / 1000;
        const rowsDone = Math.min(completed * BATCH_SIZE, TOTAL_ROWS);
        console.log(
          `  ${rowsDone.toLocaleString()}/${TOTAL_ROWS.toLocaleString()} rows (${elapsed.toFixed(1)}s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = (Date.now() - start) / 1000;
  console.log(`\nDone. Inserted ~${TOTAL_ROWS.toLocaleString()} rows in ${elapsed.toFixed(1)}s`);
  console.log(`Rate: ${(TOTAL_ROWS / elapsed).toFixed(0)} rows/sec`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});