import { runRetentionCleanup } from './service';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; 
export function getRetentionDays(): number {
  const value = process.env.RETENTION_DAYS;
  const parsed = value ? Number(value) : DEFAULT_RETENTION_DAYS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

function getIntervalMs(): number {
  const value = process.env.RETENTION_INTERVAL_MS;
  const parsed = value ? Number(value) : DEFAULT_INTERVAL_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

let timer: NodeJS.Timeout | null = null;

async function runOnce() {
  const retentionDays = getRetentionDays();
  try {
    const deleted = await runRetentionCleanup(retentionDays);
    if (deleted > 0) {
      console.log(`[retention] deleted ${deleted} expired log(s) older than ${retentionDays} days`);
    }
  } catch (err) {
    console.error('[retention] cleanup failed:', err);
  }
}

export function startRetentionScheduler() {
  const intervalMs = getIntervalMs();
  console.log(
    `[retention] scheduler started: retentionDays=${getRetentionDays()}, intervalMs=${intervalMs}`
  );

  timer = setInterval(runOnce, intervalMs);
  
  runOnce();
}

export function stopRetentionScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}