import { pool } from '../db';
import { LOG_LEVELS, LogLevel } from './types';


const BUCKET_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '1h': 3600,
  '1d': 86400,
};

const ALLOWED_GROUP_BY = ['service', 'level'];

export interface AggregateQueryParams {
  service?: string;
  level?: string;
  q?: string;
  attrFilters: Record<string, string>;
  since?: string;
  until?: string;
  bucket?: string;
  group_by?: string;
}

export interface AggregateBucket {
  start: string;
  group: string | null;
  count: number;
}

export interface AggregateResult {
  buckets: AggregateBucket[];
}

type ParseResult =
  | { valid: true; params: ParsedAggregateQuery }
  | { valid: false; error: string };

interface ParsedAggregateQuery {
  service?: string;
  level?: LogLevel;
  q?: string;
  attrFilters: Record<string, string>;
  since: Date;
  until: Date;
  bucketSeconds: number;
  groupBy?: 'service' | 'level';
}

export function parseAggregateQueryParams(raw: AggregateQueryParams): ParseResult {
  if (!raw.since) {
    return { valid: false, error: 'since is required' };
  }
  if (!raw.until) {
    return { valid: false, error: 'until is required' };
  }
  if (!raw.bucket) {
    return { valid: false, error: 'bucket is required' };
  }

  const since = new Date(raw.since);
  if (isNaN(since.getTime())) {
    return { valid: false, error: `invalid since timestamp: '${raw.since}'` };
  }

  const until = new Date(raw.until);
  if (isNaN(until.getTime())) {
    return { valid: false, error: `invalid until timestamp: '${raw.until}'` };
  }

  if (until <= since) {
    return { valid: false, error: 'until must be later than since' };
  }

  const bucketSeconds = BUCKET_SECONDS[raw.bucket];
  if (!bucketSeconds) {
    return { valid: false, error: `invalid bucket: '${raw.bucket}'. must be one of 1m, 5m, 1h, 1d` };
  }

  const parsed: ParsedAggregateQuery = {
    since,
    until,
    bucketSeconds,
    attrFilters: raw.attrFilters,
  };

  if (raw.service !== undefined) {
    parsed.service = raw.service;
  }

  if (raw.level !== undefined) {
    if (!LOG_LEVELS.includes(raw.level as LogLevel)) {
      return { valid: false, error: `invalid level: '${raw.level}'` };
    }
    parsed.level = raw.level as LogLevel;
  }

  if (raw.q !== undefined) {
    parsed.q = raw.q;
  }

  if (raw.group_by !== undefined) {
    if (!ALLOWED_GROUP_BY.includes(raw.group_by)) {
      return { valid: false, error: `invalid group_by: '${raw.group_by}'. must be service or level` };
    }
    parsed.groupBy = raw.group_by as 'service' | 'level';
  }

  return { valid: true, params: parsed };
}

export async function queryAggregate(parsed: ParsedAggregateQuery): Promise<AggregateResult> {
  const hasRawOnlyFilters = Boolean(parsed.q) || Object.keys(parsed.attrFilters).length > 0;

  if (hasRawOnlyFilters) {
    return queryAggregateRaw(parsed);
  }

  return queryAggregateFromRollup(parsed);
}

async function queryAggregateFromRollup(parsed: ParsedAggregateQuery): Promise<AggregateResult> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addCondition(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  }

  addCondition('bucket_start >= ?', parsed.since.toISOString());
  addCondition('bucket_start < ?', parsed.until.toISOString());

  if (parsed.service) {
    addCondition('service = ?', parsed.service);
  }
  if (parsed.level) {
    addCondition('level = ?', parsed.level);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  values.push(parsed.bucketSeconds);
  const bucketSecParam = `$${values.length}`;

  const bucketExpr = `to_timestamp(floor(extract(epoch from bucket_start) / ${bucketSecParam}) * ${bucketSecParam})`;

  const groupColumn = parsed.groupBy;
  const selectGroup = groupColumn ? groupColumn : 'NULL';
  const groupByClause = groupColumn
    ? `GROUP BY bucket_start_agg, ${groupColumn}`
    : `GROUP BY bucket_start_agg`;
  const orderByClause = groupColumn
    ? `ORDER BY bucket_start_agg ASC, ${groupColumn} ASC`
    : `ORDER BY bucket_start_agg ASC`;

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start_agg,
      ${selectGroup} AS group_value,
      SUM(count) AS count
    FROM logs_rollup_minute
    ${whereClause}
    ${groupByClause}
    ${orderByClause}
  `;

  const result = await pool.query(sql, values);

  const buckets: AggregateBucket[] = result.rows.map((row) => ({
    start: row.bucket_start_agg.toISOString(),
    group: row.group_value,
    count: Number(row.count),
  }));

  return { buckets };
}

async function queryAggregateRaw(parsed: ParsedAggregateQuery): Promise<AggregateResult> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addCondition(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  }

  addCondition('timestamp >= ?', parsed.since.toISOString());
  addCondition('timestamp < ?', parsed.until.toISOString());

  if (parsed.service) {
    addCondition('service = ?', parsed.service);
  }
  if (parsed.level) {
    addCondition('level = ?', parsed.level);
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

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  values.push(parsed.bucketSeconds);
  const bucketSecParam = `$${values.length}`;

  const bucketExpr = `to_timestamp(floor(extract(epoch from timestamp) / ${bucketSecParam}) * ${bucketSecParam})`;

  const groupColumn = parsed.groupBy;
  const selectGroup = groupColumn ? groupColumn : 'NULL';
  const groupByClause = groupColumn
    ? `GROUP BY bucket_start, ${groupColumn}`
    : `GROUP BY bucket_start`;
  const orderByClause = groupColumn
    ? `ORDER BY bucket_start ASC, ${groupColumn} ASC`
    : `ORDER BY bucket_start ASC`;

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      ${selectGroup} AS group_value,
      COUNT(*) AS count
    FROM logs
    ${whereClause}
    ${groupByClause}
    ${orderByClause}
  `;

  const result = await pool.query(sql, values);

  const buckets: AggregateBucket[] = result.rows.map((row) => ({
    start: row.bucket_start.toISOString(),
    group: row.group_value,
    count: Number(row.count),
  }));

  return { buckets };
}