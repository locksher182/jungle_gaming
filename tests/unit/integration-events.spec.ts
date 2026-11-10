import { describe, it, expect } from "bun:test";
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from "../../src/domain/events/integration-events";
import { LedgerDirection } from "../../src/domain/models/wallet-ledger-entry";

describe("Integration Events Envelope (Unit Tests)", () => {
  it("WalletBalanceChanged deve carregar tipo e versão tipados e MoneyProps serializado", () => {
    const event = new WalletBalanceChanged({
      eventId: "evt-1",
      aggregateId: "wallet-1",
      correlationId: "corr-1",
      occurredAt: new Date("2026-07-29T15:00:00.000Z"),
      data: {
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Debit,
        money: { amount: "25.00", currency: "BRL" },
        balanceBefore: { amount: "100.00", currency: "BRL" },
        balanceAfter: { amount: "75.00", currency: "BRL" },
        walletVersion: 2,
      },
    });

    expect(event.eventType).toBe("WalletBalanceChanged");
    expect(event.version).toBe(1);

    const json = event.toJSON();
    expect(json.eventType).toBe("WalletBalanceChanged");
    expect(json.occurredAt).toBe("2026-07-29T15:00:00.000Z");
    expect(json.data.money.amount).toBe("25.00");
  });
});
