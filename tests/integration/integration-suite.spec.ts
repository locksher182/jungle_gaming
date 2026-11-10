import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../test-helper";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/models/wager-transaction";
import { DomainError } from "../../src/domain/errors/domain-error";

describe("Testes de Integração e Garantias de Banco (Seção 13)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it("Garantia DDL 1: Banco deve rejeitar saldo negativo no schema via CHECK constraint (balance >= 0)", async () => {
    let errorCaught: any = null;
    try {
      await ctx.pglite.query(
        "INSERT INTO wallets (id, player_id, currency, balance, version) VALUES ($1, $2, $3, $4, $5)",
        ["wallet-neg", "player-neg", "BRL", -50.0, 1]
      );
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(String(errorCaught.message)).toContain("check_wallet_balance_positive");
  });

  it("Garantia DDL 2: Banco deve impedir múltiplas carteiras para o mesmo playerId + currency (UNIQUE constraint)", async () => {
    await ctx.createWalletUseCase.execute({
      playerId: "player-unique",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    let errorCaught: any = null;
    try {
      // Direct SQL attempt to bypass use-case check
      await ctx.pglite.query(
        "INSERT INTO wallets (id, player_id, currency, balance, version) VALUES ($1, $2, $3, $4, $5)",
        ["wallet-dup", "player-unique", "BRL", 200.0, 1]
      );
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(String(errorCaught.message)).toContain("unique_player_currency");
  });

  it("Garantia DDL 3: Imutabilidade do Ledger - Banco deve rejeitar UPDATE ou DELETE em registros do ledger", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-ledger-immutability",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const entries = await ctx.pglite.query<{ id: string }>("SELECT id FROM wallet_ledger WHERE wallet_id = $1", [
      wallet.id,
    ]);
    expect(entries.rows.length).toBeGreaterThan(0);
    const ledgerId = entries.rows[0]!.id;

    // Test UPDATE prevention via trigger
    let updateError: any = null;
    try {
      await ctx.pglite.query("UPDATE wallet_ledger SET amount = 999.00 WHERE id = $1", [ledgerId]);
    } catch (err) {
      updateError = err;
    }
    expect(updateError).toBeDefined();
    expect(String(updateError.message)).toContain("Ledger entries are immutable");

    // Test DELETE prevention via trigger
    let deleteError: any = null;
    try {
      await ctx.pglite.query("DELETE FROM wallet_ledger WHERE id = $1", [ledgerId]);
    } catch (err) {
      deleteError = err;
    }
    expect(deleteError).toBeDefined();
    expect(String(deleteError.message)).toContain("Ledger entries are immutable");
  });

  it("Atomicidade Transacional: Wallet, Ledger, Inbox e Outbox devem comitar juntos na mesma transação SQL", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-atomic",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    // Attempt a transaction where a failure is injected before commit
    try {
      await ctx.transactionRunner.run(async (uow) => {
        const w = await uow.wallets.findByIdForUpdate(wallet.id);
        w!.debit({ transactionId: "atomic-tx-fail", amount: { ...wallet.balance } as any });
        await uow.wallets.save(w!);

        // Simulate crash/error inside transaction
        throw new Error("SIMULATED_TRANSACTION_FAILURE");
      });
    } catch {
      // Expected rollback
    }

    // Verify wallet was NOT modified after rollback
    const reloaded = await ctx.transactionRunner.run((uow) => uow.wallets.findById(wallet.id));
    expect(reloaded!.balance.toJSON().amount).toBe("100.00");
    expect(reloaded!.version).toBe(1);
  });

  it("Reconciliação Contábil: POST /wallets/:walletId/reconciliation deve auditar storedBalance vs calculatedBalance", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-reconcile",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    // Normal operations: 1 bet of 30.00, 1 win of 50.00 -> balance should be 120.00
    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-rec",
      externalTransactionId: "tx-bet-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });

    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-rec",
      externalTransactionId: "tx-win-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Win,
      money: { amount: "50.00", currency: "BRL" },
    });

    const reconBefore = await ctx.reconcileWalletUseCase.execute(wallet.id);
    expect(reconBefore.consistent).toBe(true);
    expect(reconBefore.storedBalance.amount).toBe("120.00");
    expect(reconBefore.calculatedBalance.amount).toBe("120.00");
    expect(reconBefore.anomalyDetected).toBe(false);

    // Tamper with balance directly in DB to test anomaly detection
    await ctx.pglite.query("UPDATE wallets SET balance = 999.00 WHERE id = $1", [wallet.id]);

    const reconAfter = await ctx.reconcileWalletUseCase.execute(wallet.id);
    expect(reconAfter.consistent).toBe(false);
    expect(reconAfter.anomalyDetected).toBe(true);
    expect(reconAfter.storedBalance.amount).toBe("999.00");
    expect(reconAfter.calculatedBalance.amount).toBe("120.00");
  });

  it("API Idempotência: Mesma Idempotency-Key com payload diferente deve retornar 409 Conflict", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-idemp",
      initialBalance: { amount: "200.00", currency: "BRL" },
    });

    // First request
    const firstRes = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-idemp",
      externalTransactionId: "tx-first",
      idempotencyKey: "fixed-key-123",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    });
    expect(firstRes.status).toBe(WagerTransactionStatus.Processed);
    expect(firstRes.isReplay).toBe(false);

    // Second request: SAME idempotency key, DIFFERENT payload (amount 75.00)
    let conflictError: any = null;
    try {
      await ctx.processWagerTxUseCase.execute({
        providerId: "prov-idemp",
        externalTransactionId: "tx-divergent",
        idempotencyKey: "fixed-key-123",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "75.00", currency: "BRL" },
      });
    } catch (err) {
      conflictError = err;
    }

    expect(conflictError).toBeInstanceOf(DomainError);
    expect(conflictError.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
