import { InboxMessage } from "../../domain/models/inbox-message";
import { computeCanonicalPayloadHash } from "../../domain/utils/canonical-json";
import type { ITransactionRunner } from "../../application/ports/unit-of-work.interface";
import type {
  ProcessWagerTransactionUseCase,
  ProcessWagerTransactionDto,
} from "../../application/use-cases/process-wager-transaction.use-case";

export interface SqsMessage {
  messageId: string;
  body: string; // JSON string of ProcessWagerTransactionDto
  receiptHandle?: string;
  messageGroupId?: string;
  approximateReceiveCount?: number;
}

export interface SqsQueueClient {
  deleteMessage(receiptHandle: string): Promise<void>;
  changeMessageVisibility?(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>;
}

export class SqsConsumer {
  private isShuttingDown = false;
  private inFlightCount = 0;

  constructor(
    private readonly consumerName: string,
    private readonly transactionRunner: ITransactionRunner,
    private readonly processWagerTxUseCase: ProcessWagerTransactionUseCase,
    private readonly sqsClient?: SqsQueueClient
  ) {}

  public async handleMessage(
    message: SqsMessage
  ): Promise<{ acknowledged: boolean; alreadyProcessed?: boolean }> {
    if (this.isShuttingDown) {
      if (this.sqsClient?.changeMessageVisibility && message.receiptHandle) {
        // Return visibility immediately so other instances can take over
        await this.sqsClient.changeMessageVisibility(message.receiptHandle, 0).catch(() => {});
      }
      return { acknowledged: false };
    }

    this.inFlightCount++;
    try {
      const raw = JSON.parse(message.body);
      const payload: ProcessWagerTransactionDto = raw.data ?? raw;
      const payloadHash = computeCanonicalPayloadHash(payload);

      // 1. Transactional Inbox check & execution inside the same SQL transaction
      const shouldAck = await this.transactionRunner.run(async (uow) => {
        const inboxMsg = InboxMessage.receive({
          messageId: message.messageId,
          consumerName: this.consumerName,
          payloadHash,
        });

        const isNew = await uow.inbox.save(inboxMsg);
        if (!isNew) {
          // Already processed earlier!
          return { alreadyProcessed: true };
        }

        // Execute exactly the same use case within this atomic SQL transaction!
        await this.processWagerTxUseCase.execute(payload, uow);

        // Mark processed in inbox
        inboxMsg.markProcessed(new Date());
        await uow.inbox.save(inboxMsg);

        return { alreadyProcessed: false };
      });

      // 2. ACK message in SQS strictly AFTER SQL commit
      if (this.sqsClient && message.receiptHandle) {
        await this.sqsClient.deleteMessage(message.receiptHandle);
      }

      return { acknowledged: true, alreadyProcessed: shouldAck.alreadyProcessed };
    } catch (error) {
      // Exponential backoff via SQS visibility timeout on transient failure
      if (this.sqsClient?.changeMessageVisibility && message.receiptHandle) {
        const attempt = message.approximateReceiveCount ?? 1;
        const visibilitySeconds = Math.min(Math.pow(2, attempt) * 5, 300);
        try {
          await this.sqsClient.changeMessageVisibility(message.receiptHandle, visibilitySeconds);
        } catch {
          // Non-blocking catch for visibility update
        }
      }
      throw error;
    } finally {
      this.inFlightCount--;
    }
  }

  // Concurrency grouped by messageGroupId (maintains strict FIFO per wallet/group)
  public async handleBatch(
    messages: SqsMessage[]
  ): Promise<Array<{ messageId: string; acknowledged: boolean; alreadyProcessed?: boolean }>> {
    if (this.isShuttingDown || messages.length === 0) {
      return [];
    }

    // Partition batch by group
    const groups = new Map<string, SqsMessage[]>();
    for (const msg of messages) {
      const key = msg.messageGroupId ?? msg.messageId;
      const list = groups.get(key) ?? [];
      list.push(msg);
      groups.set(key, list);
    }

    // Process different groups concurrently, preserve sequence within each group
    const groupResults = await Promise.all(
      Array.from(groups.values()).map(async (group) => {
        const results: Array<{
          messageId: string;
          acknowledged: boolean;
          alreadyProcessed?: boolean;
        }> = [];
        for (const msg of group) {
          const res = await this.handleMessage(msg);
          results.push({
            messageId: msg.messageId,
            acknowledged: res.acknowledged,
            alreadyProcessed: res.alreadyProcessed,
          });
        }
        return results;
      })
    );

    return groupResults.flat();
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const start = Date.now();
    while (this.inFlightCount > 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
