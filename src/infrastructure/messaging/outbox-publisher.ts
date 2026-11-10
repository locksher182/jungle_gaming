import type { ITransactionRunner } from "../../application/ports/unit-of-work.interface";
import type { OutboxMessage } from "../../domain/models/outbox-message";
import { PrometheusService } from "../observability/prometheus-metrics";

export interface IEventPublisher {
  publish(eventType: string, payload: unknown): Promise<void>;
}

export class OutboxPublisher {
  constructor(
    private readonly transactionRunner: ITransactionRunner,
    private readonly eventPublisher?: IEventPublisher
  ) {}

  public async publishBatch(batchSize: number = 50): Promise<number> {
    // Phase 1: Claim due messages inside a short database transaction with SKIP LOCKED
    const claimedMessages: OutboxMessage[] = await this.transactionRunner.run(async (uow) => {
      const messages = await uow.outbox.fetchDueMessages(batchSize);
      if (messages.length === 0) return [];

      const leaseUntil = new Date(Date.now() + 30000); // 30s lease to prevent duplicate pickup during I/O
      for (const msg of messages) {
        msg.scheduleRetry(new Date(leaseUntil.getTime() - 1000));
        await uow.outbox.update(msg);
      }
      return messages;
    });

    if (claimedMessages.length === 0) return 0;

    let publishedCount = 0;
    const now = new Date();

    // Phase 2: Perform network dispatch OUTSIDE the database transaction
    for (const msg of claimedMessages) {
      let isSuccess = false;
      try {
        if (this.eventPublisher) {
          await this.eventPublisher.publish(msg.eventType, msg.payload);
        }
        isSuccess = true;
      } catch {
        isSuccess = false;
      }

      // Phase 3: Update final status in a quick SQL transaction
      await this.transactionRunner.run(async (uow) => {
        if (isSuccess) {
          msg.markPublished(now);
          await uow.outbox.update(msg);
          publishedCount++;
          try {
            const prom = PrometheusService.getInstance();
            prom.outboxPublishedTotal.inc({ eventType: msg.eventType });
          } catch {
            // non-blocking telemetry
          }
        } else {
          msg.scheduleRetry(now);
          await uow.outbox.update(msg);
        }
      });
    }

    return publishedCount;
  }
}
