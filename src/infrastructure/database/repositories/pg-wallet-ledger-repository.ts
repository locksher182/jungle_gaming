import type { SqlExecutor } from "../database.interface";
import type {
  IWalletLedgerRepository,
  LedgerCursorPagination,
  PaginatedLedgerResult,
} from "../../../domain/repositories/wallet-ledger-repository.interface";
import {
  WalletLedgerEntry,
  type LedgerDirection,
} from "../../../domain/models/wallet-ledger-entry";
import { Money } from "../../../domain/models/money";
import Decimal from "decimal.js";

export class PgWalletLedgerRepository implements IWalletLedgerRepository {
  constructor(private readonly db: SqlExecutor) {}

  public async save(entry: WalletLedgerEntry): Promise<void> {
    const sql = `
      INSERT INTO wallet_ledger (
        id, wallet_id, transaction_id, direction, amount, currency,
        balance_before, balance_after, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await this.db.query(sql, [
      entry.id,
      entry.walletId,
      entry.transactionId,
      entry.direction,
      entry.money.toJSON().amount,
      entry.money.currency,
      entry.balanceBefore.toJSON().amount,
      entry.balanceAfter.toJSON().amount,
      entry.createdAt,
    ]);
  }

  public async findByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    const res = await this.db.query(
      "SELECT * FROM wallet_ledger WHERE wallet_id = $1 ORDER BY created_at ASC, id ASC",
      [walletId]
    );
    return res.rows.map((r) => this.mapToDomain(r));
  }

  public async findByWalletIdPaginated(
    walletId: string,
    options: LedgerCursorPagination
  ): Promise<PaginatedLedgerResult> {
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);

    let sql: string;
    let params: unknown[];

    if (options.cursor) {
      try {
        const decoded = Buffer.from(options.cursor, "base64").toString("utf-8");
        const [timeStr, id] = decoded.split("|");
        const cursorDate = new Date(timeStr!);
        sql = `
          SELECT * FROM wallet_ledger
          WHERE wallet_id = $1 AND (created_at < $2 OR (created_at = $2 AND id < $3))
          ORDER BY created_at DESC, id DESC
          LIMIT $4
        `;
        params = [walletId, cursorDate, id, limit];
      } catch {
        sql = `
          SELECT * FROM wallet_ledger
          WHERE wallet_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2
        `;
        params = [walletId, limit];
      }
    } else {
      sql = `
        SELECT * FROM wallet_ledger
        WHERE wallet_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `;
      params = [walletId, limit];
    }

    const res = await this.db.query(sql, params);
    const items = res.rows.map((r) => this.mapToDomain(r));

    let nextCursor: string | undefined;
    if (items.length === limit) {
      const lastItem = items[items.length - 1]!;
      nextCursor = Buffer.from(`${lastItem.createdAt.toISOString()}|${lastItem.id}`).toString("base64");
    }

    return {
      items,
      nextCursor,
    };
  }

  private mapToDomain(row: any): WalletLedgerEntry {
    const amountStr = new Decimal(row.amount).toFixed(2);
    const beforeStr = new Decimal(row.balance_before).toFixed(2);
    const afterStr = new Decimal(row.balance_after).toFixed(2);

    return WalletLedgerEntry.rehydrate({
      id: row.id,
      walletId: row.wallet_id,
      transactionId: row.transaction_id,
      direction: row.direction as LedgerDirection,
      money: Money.from({ amount: amountStr, currency: row.currency }),
      balanceBefore: Money.from({ amount: beforeStr, currency: row.currency }),
      balanceAfter: Money.from({ amount: afterStr, currency: row.currency }),
      createdAt: new Date(row.created_at),
    });
  }
}

