import { PoolClient } from 'pg';
import { pool } from '../db';
import { ValidLogEntry } from './types';
import { from as copyFrom } from 'pg-copy-streams';
import { stringify } from 'csv-stringify';
import { pipeline } from 'node:stream/promises';

export async function insertLogsWithClient(
  client: PoolClient,
  entries: ValidLogEntry[]
): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }

  const copyStream = client.query(
    copyFrom(
      `COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT csv)`
    )
  );

  const csvStream = stringify();

  for (const entry of entries) {
    csvStream.write([
      entry.timestamp,
      entry.level,
      entry.service,
      entry.message,
      JSON.stringify(entry.attributes),
    ]);
  }
  csvStream.end();

  await pipeline(csvStream, copyStream);

  return entries.length;
}

export async function insertLogs(entries: ValidLogEntry[]): Promise<number> {
  const client = await pool.connect();
  try {
    return await insertLogsWithClient(client, entries);
  } finally {
    client.release();
  }
}

function toMinuteBucket(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

export async function upsertRollup(client: PoolClient, entries: ValidLogEntry[]): Promise<void> {
  interface RollupCount {
    bucket: string;
    service: string;
    level: string;
    count: number;
  }

  const counts = new Map<string, RollupCount>();

  for (const entry of entries) {
    const bucket = toMinuteBucket(entry.timestamp);
    const key = `${bucket}\u0000${entry.service}\u0000${entry.level}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { bucket, service: entry.service, level: entry.level, count: 1 });
    }
  }

  if (counts.size === 0) return;

  const buckets: string[] = [];
  const services: string[] = [];
  const levels: string[] = [];
  const countValues: number[] = [];

  for (const c of counts.values()) {
    buckets.push(c.bucket);
    services.push(c.service);
    levels.push(c.level);
    countValues.push(c.count);
  }

  await client.query(
    `
    INSERT INTO logs_rollup_minute (bucket_start, service, level, count)
    SELECT * FROM UNNEST($1::timestamptz[], $2::text[], $3::text[], $4::bigint[])
    ON CONFLICT (bucket_start, service, level)
    DO UPDATE SET count = logs_rollup_minute.count + EXCLUDED.count
    `,
    [buckets, services, levels, countValues]
  );
}