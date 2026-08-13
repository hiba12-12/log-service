const BASE_URL = process.env.LOADTEST_URL || 'http://localhost:8080';
const DURATION_SEC = Number(process.argv[2] || 30);

function isoMinutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60 * 1000).toISOString();
}

const latencies: number[] = [];
let errors = 0;

async function runOnce() {
  const since = isoMinutesAgo(60);
  const until = new Date().toISOString();
  const url = `${BASE_URL}/logs/aggregate?since=${encodeURIComponent(since)}&until=${encodeURIComponent(
    until
  )}&bucket=1m&group_by=service`;

  const start = Date.now();
  try {
    const res = await fetch(url);
    await res.json();
    latencies.push(Date.now() - start);
    if (!res.ok) errors++;
  } catch {
    errors++;
  }
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

async function main() {
  console.log(`Testing GET /logs/aggregate latency for ${DURATION_SEC}s (~1 req/sec)`);
  const start = Date.now();

  while ((Date.now() - start) / 1000 < DURATION_SEC) {
    const loopStart = Date.now();
    await runOnce();
    const waitMs = 1000 - (Date.now() - loopStart);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  }

  console.log('\n=== Aggregate Query Latency Results ===');
  console.log(`Requests: ${latencies.length}, errors: ${errors}`);
  console.log(`p50: ${percentile(latencies, 50)}ms`);
  console.log(`p95: ${percentile(latencies, 95)}ms`);
  console.log(`p99: ${percentile(latencies, 99)}ms`);
  console.log(`max: ${latencies.length ? Math.max(...latencies) : 0}ms`);
}

main();
export {};