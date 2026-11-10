import { describe, it, expect } from "bun:test";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/wager-transaction";
import { Money } from "../../src/domain/models/money";
import { DomainError } from "../../src/domain/errors/domain-error";

describe("WagerTransaction Model (Unit Tests)", () => {
  const baseProps = {
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-100",
    idempotencyKey: "provider-a:ext-100",
    payloadHash: "hash-abc-123",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: "25.00", currency: "BRL" }),
    referenceExternalTransactionId: undefined,
  };

  describe("Criação e Invariantes Iniciais", () => {
    it("deve nascer no estado PENDING", () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.isTerminal()).toBe(false);
      expect(tx.affectsBalance()).toBe(true);
    });

    it("LOSS não afeta saldo", () => {
      const lossTx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Loss,
      });
      expect(lossTx.affectsBalance()).toBe(false);
    });

    it("REFUND e ROLLBACK exigem referenceExternalTransactionId", () => {
      expect(() => {
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: undefined,
        });
      }).toThrow(DomainError);

      expect(() => {
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: undefined,
        });
      }).toThrow(DomainError);
    });
  });

  describe("Transições de Estado e Estados Terminais", () => {
    it("deve transicionar para PROCESSED e registrar processedAt", () => {
      const tx = WagerTransaction.create(baseProps);
      const now = new Date();
      tx.markProcessed(undefined, now);

      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.isTerminal()).toBe(true);
      expect(tx.processedAt).toEqual(now);
    });

    it("deve transicionar para PENDING_REFERENCE", () => {
      const refundTx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-original-bet",
      });

      refundTx.markPendingReference();
      expect(refundTx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(refundTx.isTerminal()).toBe(false);
    });

    it("deve rejeitar transição a partir de um estado terminal (PROCESSED, REJECTED, FAILED)", () => {
      const tx = WagerTransaction.create(baseProps);
      tx.markProcessed(undefined, new Date());

      // Já é PROCESSED (terminal)
      expect(() => tx.reject("INSUFFICIENT_FUNDS")).toThrow(DomainError);
      expect(() => tx.markProcessed(undefined, new Date())).toThrow(DomainError);
      expect(() => tx.markPendingReference()).toThrow(DomainError);
    });
  });

  describe("Idempotência: Replay vs Conflito", () => {
    it("deve identificar payload idêntico como replay legítimo", () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.matchesPayload("hash-abc-123")).toBe(true);
    });

    it("deve identificar hash divergente como conflito", () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.matchesPayload("hash-diferente")).toBe(false);
    });
  });
});
