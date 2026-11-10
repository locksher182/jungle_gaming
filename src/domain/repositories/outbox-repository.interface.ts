import type { OutboxMessage } from "../models/outbox-message";

export interface IOutboxRepository {
  save(message: OutboxMessage): Promise<void>;
  fetchDueMessages(limit: number): Promise<OutboxMessage[]>;
  update(message: OutboxMessage): Promise<void>;
}

