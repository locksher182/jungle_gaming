import { describe, it, expect } from "bun:test";
import { PrometheusService } from "../../src/infrastructure/observability/prometheus-metrics";

describe("Prometheus Metrics (/metrics)", () => {
  it("deve registrar métricas de transações e expor formato Prometheus", async () => {
    const prom = PrometheusService.getInstance();

    prom.transactionsTotal.inc({
      status: "PROCESSED",
      kind: "BET",
      providerId: "test-provider",
    });

    prom.idempotentReplaysTotal.inc({
      providerId: "test-provider",
    });

    const metricsOutput = await prom.getMetrics();

    expect(metricsOutput).toContain("jg_wagering_transactions_total");
    expect(metricsOutput).toContain('status="PROCESSED"');
    expect(metricsOutput).toContain('kind="BET"');
    expect(metricsOutput).toContain('providerId="test-provider"');
    expect(metricsOutput).toContain("jg_wagering_idempotent_replays_total");
  });
});
