# 8. Embedded Real PostgreSQL (PGlite WASM) for Zero-Mock Testing

Date: 2026-11-10  
Status: Accepted

## Context

High-integrity financial systems rely heavily on database constraints: `CHECK` constraints (e.g. non-negative balance), unique indexes, foreign keys, triggers (preventing ledger mutations), and transaction isolation semantics. Testing against in-memory mocks (e.g., in-memory JavaScript maps or arrays) fails to validate real SQL behavior and can hide concurrency bugs, transaction leaks, or invalid constraints. Relying exclusively on external Docker daemons introduces fragility in CI environments and developer workstations where Docker may not be running.

## Decision

Utilize **PGlite (`@electric-sql/pglite`)** as the database engine for integration and concurrency tests:

1. PGlite is the official C codebase of PostgreSQL compiled directly to WebAssembly (WASM).
2. It executes real PostgreSQL engine logic: the exact same migration DDL (`001_initial_schema.sql`), PL/pgSQL triggers, `CHECK` constraints, partial unique indexes, and ACID transactions (`BEGIN`, `COMMIT`, `ROLLBACK`).
3. Zero database mocking: queries, locks, triggers, and rollback behaviors run against an actual relational engine.
4. For production and staging environments, native `pg.Pool` connects to external PostgreSQL instances via `DATABASE_URL`.

## Alternatives Considered

- **In-memory Repository Mocks:** Rejected. Mocks do not enforce SQL constraints, transactions, or lock semantics.
- **SQLite in Compatibility Mode:** Rejected. SQLite lacks PL/pgSQL trigger syntax, differs in constraint handling, and does not replicate PostgreSQL locking behavior.

## Consequences

- **Positive:** High-speed, deterministic test execution with complete fidelity to PostgreSQL 16 semantics.
- **Architecture:** Abstracted behind `IDatabaseService`, allowing seamless switching between native `pg.Pool` and embedded PGlite.
