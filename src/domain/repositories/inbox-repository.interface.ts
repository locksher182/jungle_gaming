import type { InboxMessage } from "../models/inbox-message";

export interface IInboxRepository {
  find(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  save(message: InboxMessage): Promise<boolean>; // Returns false if duplicate primary key / unique constraint
}

