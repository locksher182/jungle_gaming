import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
} from "@aws-sdk/client-sqs";
import type { SqsQueueClient, SqsMessage } from "./sqs-consumer";
import { StructuredLogger } from "../observability/logger";

export interface RealSqsConfig {
  endpoint?: string;
  region?: string;
  queueUrl?: string;
}

export class RealSqsClient implements SqsQueueClient {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(config: RealSqsConfig = {}) {
    const endpoint = config.endpoint || process.env.SQS_ENDPOINT || "http://localhost:4566";
    const region = config.region || process.env.AWS_DEFAULT_REGION || "us-east-1";

    this.client = new SQSClient({
      endpoint,
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });

    this.queueUrl =
      config.queueUrl ||
      process.env.SQS_QUEUE_URL ||
      `${endpoint}/000000000000/wager-transactions.fifo`;
  }

  public async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );
  }

  public async changeMessageVisibility(
    receiptHandle: string,
    visibilityTimeoutSeconds: number
  ): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeoutSeconds,
      })
    );
  }

  public async receiveMessages(
    maxNumberOfMessages = 10,
    waitTimeSeconds = 5
  ): Promise<SqsMessage[]> {
    try {
      const resp = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: maxNumberOfMessages,
          WaitTimeSeconds: waitTimeSeconds,
          MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
        })
      );

      if (!resp.Messages || resp.Messages.length === 0) {
        return [];
      }

      return resp.Messages.map((m) => ({
        messageId: m.MessageId ?? crypto.randomUUID(),
        body: m.Body ?? "{}",
        receiptHandle: m.ReceiptHandle,
        messageGroupId: m.Attributes?.MessageGroupId,
        approximateReceiveCount: m.Attributes?.ApproximateReceiveCount
          ? parseInt(m.Attributes.ApproximateReceiveCount, 10)
          : 1,
      }));
    } catch (err: any) {
      StructuredLogger.warn("Failed to receive messages from SQS", { error: err?.message });
      return [];
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new ListQueuesCommand({ MaxResults: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}
