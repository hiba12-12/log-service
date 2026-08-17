import { pool } from '../db';
import { ValidLogEntry } from './types';
import { from as copyFrom } from 'pg-copy-streams';
import { stringify } from 'csv-stringify';
import { pipeline } from 'node:stream/promises';

export async function insertLogs(entries: ValidLogEntry[]): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }

  const client = await pool.connect();
  try {
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
  } finally {
    client.release();
  }
}