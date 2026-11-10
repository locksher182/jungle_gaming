import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { PGlite } from "@electric-sql/pglite";
import type { IDatabaseService, QueryResult, SqlExecutor } from "./database.interface";

export class PostgresDatabaseService implements IDatabaseService {
  private pool?: Pool;
  private pglite?: PGlite;

  constructor(options?: { connectionString?: string; pglite?: PGlite }) {
    if (options?.pglite) {
      this.pglite = options.pglite;
    } else if (options?.connectionString) {
      this.pool = new Pool({ connectionString: options.connectionString });
    } else {
      // Default to PGlite if no connection string is provided
      this.pglite = new PGlite();
    }
  }

  public async query<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (this.pglite) {
      const res = await this.pglite.query<T>(sql, params as any[]);
      return { rows: res.rows, rowCount: res.rows.length };
    }
    if (this.pool) {
      const res = await this.pool.query<T>(sql, params as any[]);
      return { rows: res.rows, rowCount: res.rowCount ?? 0 };
    }
    throw new Error("No database driver initialized");
  }

  public async transaction<T>(callback: (client: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.pglite) {
      return await this.pglite.transaction(async (tx) => {
        const executor: SqlExecutor = {
          query: async <R extends QueryResultRow = any>(sql: string, params?: unknown[]) => {
            const res = await tx.query<R>(sql, params as any[]);
            return { rows: res.rows, rowCount: res.rows.length };
          },
        };
        return await callback(executor);
      });
    }

    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const executor: SqlExecutor = {
          query: async <R extends QueryResultRow = any>(sql: string, params?: unknown[]) => {
            const res = await client.query<R>(sql, params as any[]);
            return { rows: res.rows, rowCount: res.rows.length };
          },
        };
        const result = await callback(executor);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    throw new Error("No database driver initialized");
  }

  public async close(): Promise<void> {
    if (this.pglite) {
      await this.pglite.close();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
