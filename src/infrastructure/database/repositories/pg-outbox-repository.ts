import type { SqlExecutor } from "../database.interface";
import type { IOutboxRepository } from "../../../domain/repositories/outbox-repository.interface";
import { OutboxMessage } from "../../../domain/models/outbox-message";

export class PgOutboxRepository implements IOutboxRepository {
  constructor(private readonly db: SqlExecutor) {}

  public async save(message: OutboxMessage): Promise<void> {
    const sql = `
      INSERT INTO outbox_messages (
        id, aggregate_id, event_type, payload, attempts, occurred_at, next_attempt_at, published_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        attempts = EXCLUDED.attempts,
        next_attempt_at = EXCLUDED.next_attempt_at,
        published_at = EXCLUDED.published_at
    `;
    await this.db.query(sql, [
      message.id,
      message.aggregateId,
      message.eventType,
      JSON.stringify(message.payload),
      message.attempts,
      message.occurredAt,
      message.nextAttemptAt ?? null,
      message.publishedAt ?? null,
    ]);
  }

  public async fetchDueMessages(limit: number): Promise<OutboxMessage[]> {
    const sql = `
      SELECT * FROM outbox_messages
      WHERE published_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY occurred_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `;
    const res = await this.db.query(sql, [limit]);
    return res.rows.map((r) => this.mapToDomain(r));
  }

  public async update(message: OutboxMessage): Promise<void> {
    const sql = `
      UPDATE outbox_messages
      SET attempts = $1,
          next_attempt_at = $2,
          published_at = $3
      WHERE id = $4
    `;
    await this.db.query(sql, [
      message.attempts,
      message.nextAttemptAt ?? null,
      message.publishedAt ?? null,
      message.id,
    ]);
  }

  private mapToDomain(row: any): OutboxMessage {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload,
      attempts: Number(row.attempts),
      occurredAt: new Date(row.occurred_at),
      nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : undefined,
      publishedAt: row.published_at ? new Date(row.published_at) : undefined,
    });
  }
}

