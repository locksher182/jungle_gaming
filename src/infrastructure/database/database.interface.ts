import type { QueryResultRow } from "pg";

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface SqlExecutor {
  query<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface IDatabaseService extends SqlExecutor {
  transaction<T>(callback: (client: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
