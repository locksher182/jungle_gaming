import type { SqlExecutor } from "../database.interface";
import type { IWagerTransactionRepository } from "../../../domain/repositories/wager-transaction-repository.interface";
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from "../../../domain/models/wager-transaction";
import { Money } from "../../../domain/models/money";
import Decimal from "decimal.js";

export class PgWagerTransactionRepository implements IWagerTransactionRepository {
  constructor(private readonly db: SqlExecutor) {}

  public async findById(id: string): Promise<WagerTransaction | null> {
    const res = await this.db.query("SELECT * FROM wager_transactions WHERE id = $1", [id]);
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const res = await this.db.query("SELECT * FROM wager_transactions WHERE idempotency_key = $1", [
      key,
    ]);
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string
  ): Promise<WagerTransaction | null> {
    const res = await this.db.query(
      "SELECT * FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2",
      [providerId, externalTransactionId]
    );
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async findReversalsForReference(
    providerId: string,
    referenceExternalId: string
  ): Promise<WagerTransaction[]> {
    const res = await this.db.query(
      "SELECT * FROM wager_transactions WHERE provider_id = $1 AND reference_external_transaction_id = $2 AND status = 'PROCESSED'",
      [providerId, referenceExternalId]
    );
    return res.rows.map((r) => this.mapToDomain(r));
  }

  public async findPendingReferences(limit: number = 50): Promise<WagerTransaction[]> {
    const res = await this.db.query(
      "SELECT * FROM wager_transactions WHERE status = 'PENDING_REFERENCE' ORDER BY created_at ASC LIMIT $1",
      [limit]
    );
    return res.rows.map((r) => this.mapToDomain(r));
  }

  public async save(tx: WagerTransaction): Promise<void> {
    const sql = `
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency,
        reference_external_transaction_id, status, rejection_reason, processed_at,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        processed_at = EXCLUDED.processed_at,
        updated_at = EXCLUDED.updated_at
    `;
    await this.db.query(sql, [
      tx.id,
      tx.providerId,
      tx.externalTransactionId,
      tx.idempotencyKey,
      tx.payloadHash,
      tx.walletId,
      tx.playerId,
      tx.roundId,
      tx.gameId,
      tx.kind,
      tx.money.toJSON().amount,
      tx.money.currency,
      tx.referenceExternalTransactionId ?? null,
      tx.status,
      tx.rejectionReason ?? null,
      tx.processedAt ?? null,
      tx.createdAt,
      tx.updatedAt,
    ]);
  }

  private mapToDomain(row: any): WagerTransaction {
    const amountStr = new Decimal(row.amount).toFixed(2);
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind as WagerTransactionKind,
      money: Money.from({ amount: amountStr, currency: row.currency }),
      referenceExternalTransactionId: row.reference_external_transaction_id ?? undefined,
      status: row.status as WagerTransactionStatus,
      rejectionReason: row.rejection_reason ?? undefined,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}
