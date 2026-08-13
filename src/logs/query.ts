import { pool } from '../db';
import { decodeCursor, encodeCursor } from './cursor';
import { StoredLogEntry, LOG_LEVELS, LogLevel } from './types';

export interface LogQueryParams {
  service?: string;
  level?: string;
  since?: string;
  until?: string;
  q?: string;
  attrFilters: Record<string, string>; // attr.<key>=value
  limit?: string;
  cursor?: string;
}

export interface LogQueryResult {
  logs: StoredLogEntry[];
  next_cursor: string | null;
}

type ParseResult =
  | { valid: true; params: ParsedQuery }
  | { valid: false; error: string };

interface ParsedQuery {
  service?: string;
  level?: LogLevel;
  since?: Date;
  until?: Date;
  q?: string;
  attrFilters: Record<string, string>;
  limit: number;
  cursorTimestamp?: string;
  cursorId?: string;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function parseLogQueryParams(raw: LogQueryParams): ParseResult {
  const parsed: ParsedQuery = { attrFilters: raw.attrFilters, limit: DEFAULT_LIMIT };

  if (raw.service !== undefined) {
    parsed.service = raw.service;
  }

  if (raw.level !== undefined) {
    if (!LOG_LEVELS.includes(raw.level as LogLevel)) {
      return { valid: false, error: `invalid level: '${raw.level}'` };
    }
    parsed.level = raw.level as LogLevel;
  }

  if (raw.since !== undefined) {
    const d = new Date(raw.since);
    if (isNaN(d.getTime())) {
      return { valid: false, error: `invalid since timestamp: '${raw.since}'` };
    }
    parsed.since = d;
  }

  if (raw.until !== undefined) {
    const d = new Date(raw.until);
    if (isNaN(d.getTime())) {
      return { valid: false, error: `invalid until timestamp: '${raw.until}'` };
    }
    parsed.until = d;
  }

  if (parsed.since && parsed.until && parsed.until <= parsed.since) {
    return { valid: false, error: 'until must be later than since' };
  }

  if (raw.q !== undefined) {
    parsed.q = raw.q;
  }

  if (raw.limit !== undefined) {
    const n = Number(raw.limit);
    if (!Number.isInteger(n) || isNaN(n)) {
      return { valid: false, error: `limit must be a number: '${raw.limit}'` };
    }
    if (n < 1 || n > MAX_LIMIT) {
      return { valid: false, error: `limit must be between 1 and ${MAX_LIMIT}` };
    }
    parsed.limit = n;
  }

  if (raw.cursor !== undefined) {
    const decoded = decodeCursor(raw.cursor);
    if (!decoded) {
      return { valid: false, error: 'invalid cursor' };
    }
    parsed.cursorTimestamp = decoded.timestamp;
    parsed.cursorId = decoded.id;
  }

  return { valid: true, params: parsed };
}

export async function queryLogs(parsed: ParsedQuery): Promise<LogQueryResult> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addCondition(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  }

  if (parsed.service) {
    addCondition('service = ?', parsed.service);
  }
  if (parsed.level) {
    addCondition('level = ?', parsed.level);
  }
  if (parsed.since) {
    addCondition('timestamp >= ?', parsed.since.toISOString());
  }
  if (parsed.until) {
    addCondition('timestamp < ?', parsed.until.toISOString());
  }
  if (parsed.q) {
    addCondition('message ILIKE ?', `%${parsed.q}%`);
  }
  for (const [key, value] of Object.entries(parsed.attrFilters)) {
    values.push(key);
    const keyParam = `$${values.length}`;
    values.push(value);
    const valueParam = `$${values.length}`;
    conditions.push(`attributes->>${keyParam} = ${valueParam}`);
  }

  if (parsed.cursorTimestamp && parsed.cursorId) {
    values.push(parsed.cursorTimestamp);
    const tsParam = `$${values.length}`;
    values.push(parsed.cursorId);
    const idParam = `$${values.length}`;
    conditions.push(`(timestamp, id) < (${tsParam}::timestamptz, ${idParam}::uuid)`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(parsed.limit + 1);
  const limitParam = `$${values.length}`;

  const sql = `
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT ${limitParam}
  `;

  const result = await pool.query(sql, values);
  const rows = result.rows;

  const hasMore = rows.length > parsed.limit;
  const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows;

  const logs: StoredLogEntry[] = pageRows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: row.attributes,
  }));

  let next_cursor: string | null = null;
  if (hasMore && logs.length > 0) {
    const last = logs[logs.length - 1];
    next_cursor = encodeCursor(last.timestamp, last.id);
  }

  return { logs, next_cursor };
}