import { describe, it, expect } from "bun:test";
import { Wallet } from "../../src/domain/models/wallet";
import { Money } from "../../src/domain/models/money";
import { DomainError } from "../../src/domain/errors/domain-error";

describe("Wallet Aggregate Root (Unit Tests)", () => {
  const initialMoney = Money.from({ amount: "100.00", currency: "BRL" });

  describe("Abertura e Reidratação", () => {
    it("deve criar uma nova wallet com versão 1 e saldo inicial", () => {
      const wallet = Wallet.open({
        id: "wallet-123",
        playerId: "player-456",
        initialBalance: initialMoney,
      });

      expect(wallet.id).toBe("wallet-123");
      expect(wallet.playerId).toBe("player-456");
      expect(wallet.currency).toBe("BRL");
      expect(wallet.balance.equals(initialMoney)).toBe(true);
      expect(wallet.version).toBe(1);
    });

    it("deve reidratar estado persistido sem revalidar regras de transição", () => {
      const rehydrated = Wallet.rehydrate({
        id: "wallet-rehydrated",
        playerId: "player-789",
        currency: "BRL",
        balance: Money.from({ amount: "500.00", currency: "BRL" }),
        version: 42,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      expect(rehydrated.version).toBe(42);
      expect(rehydrated.balance.toJSON().amount).toBe("500.00");
    });
  });

  describe("Débito, Crédito e Regra de Versionamento", () => {
    it("deve debitar saldo com sucesso e incrementar version apenas quando o saldo muda", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const debitAmount = Money.from({ amount: "30.00", currency: "BRL" });
      const ledgerEntry = wallet.debit({
        transactionId: "tx-debit-1",
        amount: debitAmount,
      });

      expect(wallet.balance.toJSON().amount).toBe("70.00");
      expect(wallet.version).toBe(2);
      expect(ledgerEntry.balanceBefore.toJSON().amount).toBe("100.00");
      expect(ledgerEntry.balanceAfter.toJSON().amount).toBe("70.00");
      expect(ledgerEntry.direction).toBe("DEBIT");
    });

    it("deve creditar saldo com sucesso e incrementar version", () => {
      const wallet = Wallet.open({
        id: "wallet-2",
        playerId: "player-2",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const creditAmount = Money.from({ amount: "50.00", currency: "BRL" });
      const ledgerEntry = wallet.credit({
        transactionId: "tx-credit-1",
        amount: creditAmount,
      });

      expect(wallet.balance.toJSON().amount).toBe("150.00");
      expect(wallet.version).toBe(2);
      expect(ledgerEntry.direction).toBe("CREDIT");
    });

    it("deve rejeitar débito que deixaria o saldo negativo", () => {
      const wallet = Wallet.open({
        id: "wallet-3",
        playerId: "player-3",
        initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
      });

      const excessiveAmount = Money.from({ amount: "60.00", currency: "BRL" });
      expect(() => {
        wallet.debit({
          transactionId: "tx-excessive",
          amount: excessiveAmount,
        });
      }).toThrow(DomainError);

      // Saldo e version não devem sofrer alteração após erro
      expect(wallet.balance.toJSON().amount).toBe("50.00");
      expect(wallet.version).toBe(1);
    });

    it("deve rejeitar operação com moeda diferente da carteira", () => {
      const wallet = Wallet.open({
        id: "wallet-4",
        playerId: "player-4",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const usdMoney = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => {
        wallet.debit({
          transactionId: "tx-usd",
          amount: usdMoney,
        });
      }).toThrow(DomainError);
    });
  });
});
