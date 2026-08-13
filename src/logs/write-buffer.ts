import { insertLogs } from './repository';
import { ValidLogEntry } from './types';

interface PendingFlush {
  resolve: () => void;
  reject: (err: unknown) => void;
}

let queue: ValidLogEntry[] = [];
let waiters: PendingFlush[] = [];
let flushTimer: NodeJS.Timeout | null = null;

const FLUSH_INTERVAL_MS = Number(process.env.WRITE_BUFFER_INTERVAL_MS) || 20;
const MAX_QUEUE_SIZE = Number(process.env.WRITE_BUFFER_MAX_SIZE) || 5000;

export function enqueueLogs(entries: ValidLogEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push(...entries);
    waiters.push({ resolve, reject });

    if (queue.length >= MAX_QUEUE_SIZE) {
      void flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
    }
  });
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (queue.length === 0) return;

  const batch = queue;
  const currentWaiters = waiters;
  queue = [];
  waiters = [];

  try {
    await insertLogs(batch);
    currentWaiters.forEach((w) => w.resolve());
  } catch (err) {
    currentWaiters.forEach((w) => w.reject(err));
  }
}