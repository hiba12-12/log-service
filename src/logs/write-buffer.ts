import { insertLogs } from './repository';
import { ValidLogEntry } from './types';

interface PendingFlush {
  resolve: () => void;
  reject: (err: unknown) => void;
}

let queue: ValidLogEntry[] = [];
let waiters: PendingFlush[] = [];
let flushScheduled = false;
let isFlushing = false;

const FLUSH_INTERVAL_MS = Number(process.env.WRITE_BUFFER_INTERVAL_MS) || 50;
const MAX_QUEUE_SIZE = Number(process.env.WRITE_BUFFER_MAX_SIZE) || 5000;
const HARD_CAP = Number(process.env.WRITE_BUFFER_HARD_CAP) || 50000;

export class BackpressureError extends Error {
  constructor() {
    super('write buffer is full, try again shortly');
    this.name = 'BackpressureError';
  }
}

export function enqueueLogs(entries: ValidLogEntry[]): Promise<void> {
  if (queue.length >= HARD_CAP) {
    return Promise.reject(new BackpressureError());
  }

  return new Promise((resolve, reject) => {
    queue.push(...entries);
    waiters.push({ resolve, reject });

    if (queue.length >= MAX_QUEUE_SIZE) {
      triggerFlush();
    } else {
      scheduleFlush(FLUSH_INTERVAL_MS);
    }
  });
}

function scheduleFlush(delayMs: number) {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    triggerFlush();
  }, delayMs);
}

function triggerFlush() {
  if (isFlushing) return;
  void flush();
}

async function flush() {
  if (queue.length === 0) return;

  isFlushing = true;
  const batch = queue;
  const currentWaiters = waiters;
  queue = [];
  waiters = [];

  try {
    await insertLogs(batch);
    currentWaiters.forEach((w) => w.resolve());
  } catch (err) {
    currentWaiters.forEach((w) => w.reject(err));
  } finally {
    isFlushing = false;
    
    if (queue.length > 0) {
      triggerFlush();
    }
  }
}