# Log Ingestion and Query Service

A service for ingesting, storing, and querying structured logs efficiently, designed to sustain high throughput (15,000+ logs/sec) while keeping queries fast.

## Setup and Usage

### Requirements
- Docker & Docker Compose
- (Optional, for local development) Node.js 22+

### Running the full system

```bash
docker compose up --build
```

This command automatically:
1. Builds the application image
2. Starts PostgreSQL
3. Applies all database migrations (creates the table and indexes)
4. Starts the server on `localhost:8080`

**No manual steps required.** Check readiness with:

```bash
curl http://localhost:8080/health
```

### Seeding test data (optional)

```bash
npm install
npm run seed
```

Populates the database with one million sample log rows spread across the last 30 days.

---

## API Documentation

### `GET /health`
Returns `200` once the database connection is established and migrations have been applied.

### `POST /logs`
Accepts a batch of log entries. Request/response shape matches the required contract exactly.

- Each entry is validated independently; an invalid entry does not fail the whole batch
- Response: `{ "accepted": number, "rejected": [{ "index", "reason" }] }`

### `GET /logs`
Query with freely combinable filters: `service`, `level`, `since`, `until`, `attr.<key>`, `q`, `limit`, `cursor`.
Sorted descending by `timestamp`, with `id` as a tie-breaker for deterministic ordering.
Cursor-based pagination (base64-encoded, opaque to the client).

### `GET /logs/aggregate`
Time-bucketed aggregation (`since`, `until`, `bucket` are required), with optional `group_by=service|level` and the same filters available on `GET /logs`.

### `POST /admin/retention/run` (optional, additive)
Manually triggers immediate deletion of expired data instead of waiting for the scheduled run. Useful for testing and demos. **Not part of the required contract.**

---

## Schema and Index Design

```sql
CREATE TABLE logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Indexes

| Index | Type | Purpose |
|---|---|---|
| `idx_logs_timestamp_covering` | B-tree on `timestamp` with `INCLUDE (service, level)` | Serves all time-range and ordering queries, and enables Index-Only Scans for aggregate queries (no heap access needed) |
| `idx_logs_service_timestamp` | Composite B-tree | Serves `service=X` filtering combined with time ordering in one pass |
| `idx_logs_level_timestamp` | Composite B-tree | Same idea for `level` |
| `idx_logs_attributes_gin` | GIN (`jsonb_path_ops`) | Fast equality lookups for `attr.<key>=value` |
| `idx_logs_message_trgm` | GIN (`gin_trgm_ops`) | Fast substring search (`q=`) without a full table scan |

A redundant plain `idx_logs_timestamp` index was dropped after the covering index made it unnecessary, reducing write overhead.

---

## Attribute Storage Strategy

We chose **JSONB** for storing `attributes`, instead of EAV (a separate table) or fixed columns:

- **EAV**: rejected because it multiplies row count (5 attributes on average = 5x the inserts) — a performance killer given the throughput target
- **Fixed columns**: not viable, since attribute keys are arbitrary and unknown in advance
- **JSONB**: one row per log regardless of attribute count, with a GIN index enabling fast filtering. The trade-off: JSONB lookups are somewhat slower than a dedicated column, which is acceptable since the contract only requires simple equality matching.

---

## Retention Strategy

- Retention policy is **configurable** via environment variables:
  - `RETENTION_DAYS` (default: 30)
  - `RETENTION_INTERVAL_MS` (default: 3600000 = 1 hour)
- Deletion happens **in small batches** (1000 rows at a time) with a 50ms pause between batches, to avoid long table locks or disrupting ongoing ingestion
- An automatic background timer runs cleanup periodically
- `POST /admin/retention/run` is an additional endpoint to trigger deletion immediately on demand (useful for testing)

---

## Load-Test Methodology and Measured Performance

### Test Environment
- Docker Desktop on Windows, mimicking the official resource limits (0.5 CPU / 256MB for the app, 1 CPU / 1GB for the database)
- Custom test tooling (`scripts/loadtest.ts`, `scripts/query-test.ts`) sending real HTTP requests

### Dataset Size
~1,000,000 log rows, randomly distributed over the last 30 days, with a realistic level distribution (mostly `info`, least `error`).

### Measured Results

| Metric | Value |
|---|---|
| Batch size (test) | 100 logs/request |
| Concurrency | 20 workers |
| **Throughput — ingestion alone** | ~8,500-9,700 logs/sec |
| **Throughput — under concurrent query load** | ~8,300-12,300 logs/sec |
| **Aggregate query p50 (concurrent)** | ~200-450ms |
| **Aggregate query p95 (concurrent)** | ~1,169-2,105ms |
| **Aggregate query p99 (concurrent)** | ~1,227-2,384ms |

### Bottlenecks Discovered and Optimizations Applied

1. **Default `work_mem` (4MB) was too small** → sort operations spilled to disk (`external merge Disk`). Fix: raised `work_mem=32MB` via PostgreSQL configuration.
2. **Unnecessary heap access in the aggregate query** → added a covering index (`INCLUDE (service, level)`) enabling Index-Only Scans (`Heap Fetches: 0`), cutting execution time from ~1478ms to ~450ms (isolated).
3. **Biggest bottleneck: the database is limited to a single CPU.** Every individual `INSERT` updates 5 indexes, which is CPU-heavy. The most impactful fix: **write buffering (micro-batching)** at the application level — instead of each HTTP request performing its own `INSERT`, concurrent requests within a short window (50ms) are coalesced into a single bulk `INSERT`. This raised throughput from ~2,900 to ~9,700-12,300 logs/sec (up to a 4x improvement).
4. Dropped a redundant index (`idx_logs_timestamp`) once fully superseded by the covering index.
5. Tuned `gin_pending_list_limit` and `checkpoint_completion_target` to reduce latency spikes caused by sudden GIN pending-list flushes.

---

## Known Limitations

- **Aggregate query latency under maximum concurrent load** (~1.2-2.1s at p95/p99) occasionally exceeds the one-second target, due to the single-CPU constraint on the database container mandated by the spec. Performance improves noticeably whenever CPU contention is reduced (every optimization that lowered CPU load directly improved these numbers).
- Substring search (`q=` on message) may be more sensitive to write load than fixed-field filters, due to the write cost of maintaining the GIN index.
- Tests were run on a developer machine (Windows + Docker Desktop); actual numbers may vary in the grading environment.

---

## Optional Features

| Feature | Default State | Control |
|---|---|---|
| `POST /admin/retention/run` | Always enabled (additive endpoint, does not affect the contract) | No disable flag needed — always safe |
| Write buffering (micro-batching) | Always enabled | `WRITE_BUFFER_INTERVAL_MS` (default: 50), `WRITE_BUFFER_MAX_SIZE` (default: 5000) |
| Retention scheduler | Always enabled | `RETENTION_DAYS` (default: 30), `RETENTION_INTERVAL_MS` (default: 3600000) |

**Confirmation**: `docker compose up` with no extra environment variables or manual configuration produces the plain, unauthenticated core service exactly as required by the contract — no auth, no rate limiting, and all four required endpoints open and unrestricted.

---

## Project Structure

```
src/
  db.ts                    # connection pool
  index.ts                 # entry point, route registration
  logs/
    types.ts               # shared type definitions
    validation.ts           # per-entry validation logic
    repository.ts           # bulk insert via UNNEST
    write-buffer.ts         # write coalescing (micro-batching)
    cursor.ts               # cursor encode/decode for pagination
    routes.ts               # POST /logs
    query.ts / query-routes.ts       # GET /logs
    aggregate.ts / aggregate-routes.ts  # GET /logs/aggregate
  retention/
    service.ts               # batched deletion
    scheduler.ts             # automatic scheduling
    routes.ts                # admin endpoint
migrations/                 # node-pg-migrate migrations
scripts/                    # seed and load-testing tools
.github/workflows/ci.yml    # GitHub Actions pipeline
```