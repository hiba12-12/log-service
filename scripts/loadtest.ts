const BASE_URL = process.env.LOADTEST_URL || 'http://localhost:8080';
const DURATION_SEC = Number(process.argv[2] || 30);
const CONCURRENCY = Number(process.argv[3] || 20);
const BATCH_SIZE = Number(process.argv[4] || 100);

const SERVICES = ['checkout', 'auth', 'inventory', 'payments', 'shipping'];
const LEVELS = ['debug', 'info', 'warn', 'error'];
const MESSAGES = ['request processed', 'payment declined', 'timeout', 'cache miss', 'user login'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildLog() {
  return {
    timestamp: new Date().toISOString(),
    level: pick(LEVELS),
    service: pick(SERVICES),
    message: pick(MESSAGES),
    attributes: {
      user_id: String(Math.floor(Math.random() * 100000)),
      region: 'eu-west',
    },
  };
}

function buildBatch(size: number) {
  return { logs: Array.from({ length: size }, buildLog) };
}

let totalAccepted = 0;
let totalRejected = 0;
let totalRequests = 0;
let totalErrors = 0;
let running = true;

async function worker() {
  while (running) {
    const body = JSON.stringify(buildBatch(BATCH_SIZE));
    try {
      const res = await fetch(`${BASE_URL}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      totalRequests++;
      if (res.ok) {
        const json = (await res.json()) as { accepted: number; rejected: unknown[] };
        totalAccepted += json.accepted || 0;
        totalRejected += (json.rejected || []).length;
      } else {
        totalErrors++;
      }
    } catch {
      totalErrors++;
    }
  }
}

async function main() {
  console.log(
    `Load testing POST /logs for ${DURATION_SEC}s with ${CONCURRENCY} workers, batch size ${BATCH_SIZE}`
  );
  const start = Date.now();

  const statsInterval = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const rate = totalAccepted / elapsed;
    console.log(
      `  [${elapsed.toFixed(0)}s] accepted=${totalAccepted} rate=${rate.toFixed(0)}/s requests=${totalRequests} errors=${totalErrors}`
    );
  }, 1000);

  const workers = Array.from({ length: CONCURRENCY }, () => worker());

  setTimeout(() => {
    running = false;
  }, DURATION_SEC * 1000);

  await Promise.all(workers);
  clearInterval(statsInterval);

  const elapsed = (Date.now() - start) / 1000;
  console.log('\n=== Results ===');
  console.log(`Duration: ${elapsed.toFixed(1)}s`);
  console.log(`Total accepted: ${totalAccepted}`);
  console.log(`Total rejected: ${totalRejected}`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Throughput: ${(totalAccepted / elapsed).toFixed(0)} logs/sec`);
}

main();
export {};