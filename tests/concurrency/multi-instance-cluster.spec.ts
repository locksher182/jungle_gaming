import { describe, it, expect } from "bun:test";
import { createTestContext } from "../test-helper";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/models/wager-transaction";

describe("Teste de Concorrência com Múltiplas Instâncias Reais (>= 3)", () => {
  it("deve executar 3 instâncias HTTP reais em portas distintas simultaneamente sem corrupção contábil", async () => {
    const ctx = await createTestContext();

    // Shared wallet under test
    const initialWallet = await ctx.createWalletUseCase.execute({
      playerId: "player-cluster-3inst",
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    // Spin up 3 HTTP listeners on separate ports
    const ports = [3101, 3102, 3103];
    const servers = ports.map((port) => {
      return Bun.serve({
        port,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/wagering/transactions" && req.method === "POST") {
            const body = (await req.json()) as Record<string, any>;
            const idempHeader = req.headers.get("Idempotency-Key") || undefined;
            const res = await ctx.processWagerTxUseCase.execute({
              ...body,
              idempotencyKey: idempHeader,
            } as any);
            return Response.json(res);
          }
          if (url.pathname === `/wallets/${initialWallet.id}/reconciliation` && req.method === "POST") {
            const recon = await ctx.reconcileWalletUseCase.execute(initialWallet.id);
            return Response.json(recon);
          }
          return new Response("Not Found", { status: 404 });
        },
      });
    });

    try {
      // Round-robin 30 concurrent transactions across nodes
      const requests = Array.from({ length: 30 }, (_, i) => {
        const assignedPort = ports[i % ports.length];
        const isBet = i % 2 === 0;

        return fetch(`http://localhost:${assignedPort}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `cluster-inst:tx-${i}`,
          },
          body: JSON.stringify({
            providerId: "prov-cluster",
            externalTransactionId: `cluster-tx-${i}`,
            playerId: initialWallet.playerId,
            walletId: initialWallet.id,
            roundId: `round-${i}`,
            gameId: "game-cluster",
            kind: isBet ? WagerTransactionKind.Bet : WagerTransactionKind.Win,
            money: { amount: "10.00", currency: "BRL" },
          }),
        }).then((res) => res.json() as Promise<any>);
      });

      const responses = await Promise.all(requests);

      // Verify every node processed cleanly
      expect(responses.length).toBe(30);
      expect(responses.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);

      // Audit balance invariant against ledger
      const reconRes = await fetch(
        `http://localhost:3101/wallets/${initialWallet.id}/reconciliation`,
        { method: "POST" }
      ).then((r) => r.json() as Promise<any>);

      expect(reconRes.consistent).toBe(true);
      expect(reconRes.anomalyDetected).toBe(false);
      // 1000 base - (15 bets * 10) + (15 wins * 10) = 1000.00
      expect(reconRes.storedBalance.amount).toBe("1000.00");
      expect(reconRes.calculatedBalance.amount).toBe("1000.00");
      // 1 opening + 30 transactions = 31 ledger entries
      expect(reconRes.ledgerEntriesCount).toBe(31);
    } finally {
      // Teardown listeners
      for (const s of servers) {
        s.stop(true);
      }
    }
  });
});
