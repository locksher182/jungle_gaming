import type { ITransactionRunner } from "../../application/ports/unit-of-work.interface";

export interface IEventPublisher {
  publish(eventType: string, payload: unknown): Promise<void>;
}

export class OutboxPublisher {
  constructor(
    private readonly transactionRunner: ITransactionRunner,
    private readonly eventPublisher?: IEventPublisher
  ) {}

  public async publishBatch(batchSize: number = 50): Promise<number> {
    return await this.transactionRunner.run(async (uow) => {
      // 1. Fetch due messages using SKIP LOCKED (safe for multiple concurrent instances)
      const messages = await uow.outbox.fetchDueMessages(batchSize);
      if (messages.length === 0) return 0;

      let publishedCount = 0;
      const now = new Date();

      for (const msg of messages) {
        try {
          if (this.eventPublisher) {
            await this.eventPublisher.publish(msg.eventType, msg.payload);
          }
          msg.markPublished(now);
          await uow.outbox.update(msg);
          publishedCount++;
        } catch {
          msg.scheduleRetry(now);
          await uow.outbox.update(msg);
        }
      }

      return publishedCount;
    });
  }
}
