import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SqsConsumer } from "./sqs-consumer";
import { RealSqsClient } from "./sqs-client";
import { OutboxPublisher } from "./outbox-publisher";
import { PendingReferenceReconciler } from "./pending-reference-reconciler";
import { StructuredLogger } from "../observability/logger";

@Injectable()
export class BackgroundWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private isRunning = false;
  private sqsPollTimer?: NodeJS.Timeout;
  private outboxTimer?: NodeJS.Timeout;
  private reconcilerTimer?: NodeJS.Timeout;

  constructor(
    private readonly sqsConsumer?: SqsConsumer,
    private readonly sqsClient?: RealSqsClient,
    private readonly outboxPublisher?: OutboxPublisher,
    private readonly pendingReferenceReconciler?: PendingReferenceReconciler
  ) {}

  public onApplicationBootstrap(): void {
    if (process.env.DISABLE_BACKGROUND_WORKERS === "true") {
      StructuredLogger.info("Background workers disabled by environment configuration");
      return;
    }

    this.isRunning = true;
    StructuredLogger.info(
      "Starting background workers (SQS Consumer, Outbox Publisher, Reference Reconciler)..."
    );

    this.startSqsPolling();
    this.startOutboxPolling();
    this.startReconcilerPolling();
  }

  public async onApplicationShutdown(signal?: string): Promise<void> {
    StructuredLogger.info(`Shutting down background workers gracefully (signal: ${signal})...`);
    this.isRunning = false;

    if (this.sqsPollTimer) clearTimeout(this.sqsPollTimer);
    if (this.outboxTimer) clearTimeout(this.outboxTimer);
    if (this.reconcilerTimer) clearTimeout(this.reconcilerTimer);

    if (this.sqsConsumer) {
      this.sqsConsumer.shutdown();
    }
  }

  private startSqsPolling(): void {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        if (this.sqsClient && this.sqsConsumer) {
          const messages = await this.sqsClient.receiveMessages(10, 2);
          if (messages.length > 0) {
            await this.sqsConsumer.handleBatch(messages);
          }
        }
      } catch (err: any) {
        StructuredLogger.warn("Error in SQS polling cycle", { error: err?.message });
      }

      if (this.isRunning) {
        // Schedule next poll cycle immediately if active, or brief sleep if idle
        this.sqsPollTimer = setTimeout(poll, 100);
      }
    };

    poll().catch(() => {});
  }

  private startOutboxPolling(): void {
    const cycle = async () => {
      if (!this.isRunning) return;

      try {
        if (this.outboxPublisher) {
          await this.outboxPublisher.publishBatch(50);
        }
      } catch (err: any) {
        StructuredLogger.warn("Error in Outbox publishing cycle", { error: err?.message });
      }

      if (this.isRunning) {
        this.outboxTimer = setTimeout(cycle, 500);
      }
    };

    cycle().catch(() => {});
  }

  private startReconcilerPolling(): void {
    const cycle = async () => {
      if (!this.isRunning) return;

      try {
        if (this.pendingReferenceReconciler) {
          await this.pendingReferenceReconciler.reconcilePendingTransactions(50);
        }
      } catch (err: any) {
        StructuredLogger.warn("Error in Pending Reference Reconciler cycle", {
          error: err?.message,
        });
      }

      if (this.isRunning) {
        this.reconcilerTimer = setTimeout(cycle, 2000);
      }
    };

    cycle().catch(() => {});
  }
}
