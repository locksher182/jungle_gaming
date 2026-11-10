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
}

export interface SqsQueueClient {
  deleteMessage(receiptHandle: string): Promise<void>;
}

export class SqsConsumer {
  private isShuttingDown = false;

  constructor(
    private readonly consumerName: string,
    private readonly transactionRunner: ITransactionRunner,
    private readonly processWagerTxUseCase: ProcessWagerTransactionUseCase,
    private readonly sqsClient?: SqsQueueClient
  ) {}

  public async handleMessage(message: SqsMessage): Promise<{ acknowledged: boolean; alreadyProcessed?: boolean }> {
    if (this.isShuttingDown) {
      return { acknowledged: false };
    }

    const payload: ProcessWagerTransactionDto = JSON.parse(message.body);
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
  }

  public shutdown(): void {
    this.isShuttingDown = true;
  }
}
