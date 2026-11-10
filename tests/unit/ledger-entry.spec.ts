import { describe, it, expect } from "bun:test";
import {
  WalletLedgerEntry,
  LedgerDirection,
} from "../../src/domain/models/wallet-ledger-entry";
import { Money } from "../../src/domain/models/money";
import { DomainError } from "../../src/domain/errors/domain-error";

describe("WalletLedgerEntry (Unit Tests)", () => {
  it("deve criar entrada de débito balanceada com sucesso", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-1",
      walletId: "wallet-1",
      transactionId: "tx-1",
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "20.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "80.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
  });

  it("deve criar entrada de crédito balanceada com sucesso", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-2",
      walletId: "wallet-1",
      transactionId: "tx-2",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "80.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "130.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it("deve rejeitar entrada com inconsistência aritmética (isBalanced falso)", () => {
    expect(() => {
      WalletLedgerEntry.create({
        id: "ledger-broken",
        walletId: "wallet-1",
        transactionId: "tx-broken",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "20.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "75.00", currency: "BRL" }), // Deveria ser 80.00
      });
    }).toThrow(DomainError);
  });
});
