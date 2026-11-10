# Distributed Wagering Processor

Backend service for processing distributed wager transactions with strict ACID guarantees, idempotency, and outbox/inbox messaging.

Stack: Bun 1.x, TypeScript (strict), NestJS, PostgreSQL 16, AWS SQS (LocalStack).

---

## Quickstart

### Requirements
* Bun >= 1.2
* Docker Compose (optional for local Postgres/LocalStack)

### Setup
```bash
bun install
```

### Type Check
```bash
bun run typecheck
```

### Tests
```bash
bun test
```

Tests run against an embedded PostgreSQL 16 engine (`@electric-sql/pglite` / WASM) executing actual DDL migrations, triggers, and constraints without mocks.

---

## Local Infrastructure

To spin up PostgreSQL and LocalStack SQS:

```bash
docker compose up -d
```

* Postgres: `localhost:5432` (`jg_db` / `jg_user` / `jg_password`)
* SQS: `http://localhost:4566` (FIFO queues: `wager-transactions.fifo`, `wager-transactions-dlq.fifo`)

---

## API Endpoints

### 1. Create Wallet
`POST /wallets`
```json
{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```
* Returns `201 Created`

### 2. Process Transaction
`POST /wagering/transactions`  
Header: `Idempotency-Key: <provider>:<tx-id>`
```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```
* Status codes:
  * `200 OK`: Processed or idempotent replay.
  * `202 Accepted`: Queued as `PENDING_REFERENCE` (out-of-order refund/rollback).
  * `409 Conflict`: Idempotency key reused with mismatched payload.
  * `422 Unprocessable`: Insufficient funds or invalid reference state.

### 3. Ledger Reconciliation
`POST /wallets/:walletId/reconciliation`
* Compares `wallets.balance` against `sum(wallet_ledger)`.

### 4. Ledger Feed (Cursor Pagination)
`GET /wallets/:walletId/ledger?cursor=<opaque>&limit=50`
* Stable cursor-based pagination (no `OFFSET`).

### 5. Health & Telemetry
* `GET /health/live`
* `GET /health/ready`
* `GET /metrics` (Prometheus format)

---

## Test Layout

```
tests/
├── unit/
│   ├── money.spec.ts             # Decimal arithmetic, ISO codes, immutability
│   ├── wallet.spec.ts            # Aggregate root, versioning, balance checks
│   ├── wager-transaction.spec.ts # State machine, terminal states, refund rules
│   ├── ledger-entry.spec.ts      # Immutability and balance verification
│   ├── canonical-hash.spec.ts    # Key sorting hash for conflict detection
│   ├── inbox-outbox.spec.ts      # SQS deduplication and exponential retry
│   ├── integration-events.spec.ts# Typed event envelopes
│   ├── logger-sanitizer.spec.ts  # Secret masking in logs and URLs
│   ├── prometheus-metrics.spec.ts# Prometheus metric registry validation
│   └── sqs-consumer-batch.spec.ts# Group-based concurrency and visibility backoff
├── integration/
│   └── integration-suite.spec.ts # CHECK balance >= 0, UNIQUE player/currency, trigger lock
└── concurrency/
    ├── concurrency-scenarios.spec.ts # 8 core race condition and crash scenarios
    └── multi-instance-cluster.spec.ts# Multi-node HTTP cluster validation
```
