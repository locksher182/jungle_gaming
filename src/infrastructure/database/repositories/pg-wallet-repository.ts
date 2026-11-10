import type { SqlExecutor } from "../database.interface";
import type { IWalletRepository } from "../../../domain/repositories/wallet-repository.interface";
import { Wallet } from "../../../domain/models/wallet";
import { Money } from "../../../domain/models/money";
import Decimal from "decimal.js";

export class PgWalletRepository implements IWalletRepository {
  constructor(private readonly db: SqlExecutor) {}

  public async findById(id: string): Promise<Wallet | null> {
    const res = await this.db.query("SELECT * FROM wallets WHERE id = $1", [id]);
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const res = await this.db.query(
      "SELECT * FROM wallets WHERE player_id = $1 AND currency = $2",
      [playerId, currency.toUpperCase()]
    );
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const res = await this.db.query("SELECT * FROM wallets WHERE id = $1 FOR UPDATE", [id]);
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async save(wallet: Wallet): Promise<void> {
    const sql = `
      INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        balance = EXCLUDED.balance,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
    `;
    await this.db.query(sql, [
      wallet.id,
      wallet.playerId,
      wallet.currency,
      wallet.balance.toJSON().amount,
      wallet.version,
      wallet.createdAt,
      wallet.updatedAt,
    ]);
  }

  private mapToDomain(row: any): Wallet {
    const amountStr = new Decimal(row.balance).toFixed(2);
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: Money.from({ amount: amountStr, currency: row.currency }),
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}
