import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export class PrometheusService {
  private static instance: PrometheusService;
  public readonly registry: Registry;

  public readonly transactionsTotal: Counter<string>;
  public readonly idempotentReplaysTotal: Counter<string>;
  public readonly transactionDurationSeconds: Histogram<string>;
  public readonly outboxPublishedTotal: Counter<string>;
  public readonly reconciliationTotal: Counter<string>;

  // Required metrics per Section 12:
  public readonly retriesTotal: Counter<string>;
  public readonly dlqMessagesTotal: Counter<string>;
  public readonly lockConflictsTotal: Counter<string>;
  public readonly outboxLag: Gauge<string>;

  private constructor() {
    this.registry = new Registry();

    collectDefaultMetrics({ register: this.registry, prefix: "jg_processor_" });

    this.transactionsTotal = new Counter({
      name: "jg_wagering_transactions_total",
      help: "Total number of wagering transactions processed by status and kind",
      labelNames: ["status", "kind", "providerId"],
      registers: [this.registry],
    });

    this.idempotentReplaysTotal = new Counter({
      name: "jg_wagering_idempotent_replays_total",
      help: "Total number of idempotent replay requests detected",
      labelNames: ["providerId"],
      registers: [this.registry],
    });

    this.transactionDurationSeconds = new Histogram({
      name: "jg_wagering_transaction_duration_seconds",
      help: "Latency of wager transactions in seconds",
      labelNames: ["status", "kind"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [this.registry],
    });

    this.outboxPublishedTotal = new Counter({
      name: "jg_outbox_messages_published_total",
      help: "Total count of integration events dispatched from outbox",
      labelNames: ["eventType"],
      registers: [this.registry],
    });

    this.reconciliationTotal = new Counter({
      name: "jg_wallet_reconciliations_total",
      help: "Total wallet reconciliation checks performed",
      labelNames: ["consistent"],
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: "jg_retries_total",
      help: "Total number of retry attempts executed",
      labelNames: ["operation", "reason"],
      registers: [this.registry],
    });

    this.dlqMessagesTotal = new Counter({
      name: "jg_dlq_messages_total",
      help: "Total count of messages routed to Dead Letter Queue (DLQ)",
      labelNames: ["queue", "reason"],
      registers: [this.registry],
    });

    this.lockConflictsTotal = new Counter({
      name: "jg_lock_conflicts_total",
      help: "Total count of lock contention or retry conflicts encountered",
      labelNames: ["resource"],
      registers: [this.registry],
    });

    this.outboxLag = new Gauge({
      name: "jg_outbox_lag",
      help: "Current number of unpublished pending integration events in outbox",
      registers: [this.registry],
    });
  }

  public static getInstance(): PrometheusService {
    if (!PrometheusService.instance) {
      PrometheusService.instance = new PrometheusService();
    }
    return PrometheusService.instance;
  }

  public async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }
}
