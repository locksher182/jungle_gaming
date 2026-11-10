import type { SqlExecutor } from "../database.interface";
import type { IInboxRepository } from "../../../domain/repositories/inbox-repository.interface";
import { InboxMessage } from "../../../domain/models/inbox-message";

export class PgInboxRepository implements IInboxRepository {
  constructor(private readonly db: SqlExecutor) {}

  public async find(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const res = await this.db.query(
      "SELECT * FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2",
      [consumerName, messageId]
    );
    if (res.rows.length === 0) return null;
    return this.mapToDomain(res.rows[0]);
  }

  public async save(message: InboxMessage): Promise<boolean> {
    const checkSql = `
      INSERT INTO inbox_messages (id, message_id, consumer_name, payload_hash, processed_at, received_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (consumer_name, message_id) DO UPDATE SET
        processed_at = EXCLUDED.processed_at
      RETURNING id, (xmax = 0) AS inserted
    `;
    const res = await this.db.query(checkSql, [
      message.id,
      message.messageId,
      message.consumerName,
      message.payloadHash,
      message.processedAt ?? null,
      message.receivedAt,
    ]);

    if (res.rows.length === 0) return false;
    // If inserted is true (or xmax = 0), it's a new row; if false, it was an update of existing
    return res.rows[0]?.inserted !== false;
  }

  private mapToDomain(row: any): InboxMessage {
    return InboxMessage.rehydrate({
      id: row.id,
      messageId: row.message_id,
      consumerName: row.consumer_name,
      payloadHash: row.payload_hash,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      receivedAt: new Date(row.received_at),
    });
  }
}
