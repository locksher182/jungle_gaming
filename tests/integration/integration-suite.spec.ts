import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../test-helper";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/wager-transaction";
import { DomainError } from "../../src/domain/errors/domain-error";

describe("Testes de Integração e Garantias de Banco", () => {
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

    const entries = await ctx.pglite.query<{ id: string }>(
      "SELECT id FROM wallet_ledger WHERE wallet_id = $1",
      [wallet.id]
    );
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

  it("Garantia DDL 4: Banco deve impedir reversão dupla (Partial Unique Index no PostgreSQL)", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-reversal-idx",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    // 1. Process Bet
    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-rev",
      externalTransactionId: "bet-original",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-rev",
      gameId: "g-rev",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });

    // 2. First refund is processed successfully
    const refundRes = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-rev",
      externalTransactionId: "refund-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-rev",
      gameId: "g-rev",
      kind: WagerTransactionKind.Refund,
      money: { amount: "30.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-original",
    });
    expect(refundRes.status).toBe(WagerTransactionStatus.Processed);

    // 3. Attempt direct SQL insertion of a second PROCESSED refund for the same reference
    let duplicateError: any = null;
    try {
      await ctx.pglite.query(
        `INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency,
          reference_external_transaction_id, status, created_at, updated_at
        ) VALUES (
          'tx-dup-rev', 'prov-rev', 'refund-2', 'prov-rev:refund-2', 'hash-rev-2',
          $1, $2, 'r-rev', 'g-rev', 'REFUND', 30.00, 'BRL',
          'bet-original', 'PROCESSED', NOW(), NOW()
        )`,
        [wallet.id, wallet.playerId]
      );
    } catch (err) {
      duplicateError = err;
    }

    expect(duplicateError).toBeDefined();
    expect(String(duplicateError.message)).toContain("wager_transactions_single_reversal_key");
  });

  it("Consultas e Resposta HTTP: Obter Wallet, Transação e Replay Idempotente com Saldo Observado", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-queries",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    // 1. Get Wallet by Id
    const fetchedWallet = await ctx.getWalletUseCase.execute(wallet.id);
    expect(fetchedWallet.id).toBe(wallet.id);
    expect(fetchedWallet.balance.toJSON().amount).toBe("100.00");

    // 2. Submit BET
    const betRes = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-q",
      externalTransactionId: "tx-q-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-q",
      gameId: "g-q",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(betRes.status).toBe(WagerTransactionStatus.Processed);
    expect(betRes.idempotentReplay).toBe(false);
    expect(betRes.balance?.amount).toBe("75.00");

    // 3. Get Transaction by ID
    const txById = await ctx.getTransactionUseCase.getById(betRes.transaction.id);
    expect(txById.id).toBe(betRes.transaction.id);
    expect(txById.observedBalance?.toJSON().amount).toBe("75.00");

    // 4. Get Transaction by Provider and External ID
    const txByExtId = await ctx.getTransactionUseCase.getByProviderAndExternalId(
      "prov-q",
      "tx-q-1"
    );
    expect(txByExtId.id).toBe(betRes.transaction.id);

    // 5. Idempotent Replay should return the historical observed balance (75.00), even after subsequent transactions!
    // Make another transaction first:
    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-q",
      externalTransactionId: "tx-q-2",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-q",
      gameId: "g-q",
      kind: WagerTransactionKind.Bet,
      money: { amount: "10.00", currency: "BRL" },
    });

    // Replay first transaction
    const replayRes = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-q",
      externalTransactionId: "tx-q-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "r-q",
      gameId: "g-q",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(replayRes.isReplay).toBe(true);
    expect(replayRes.idempotentReplay).toBe(true);
    // Historical balance observed for tx-q-1 was 75.00
    expect(replayRes.balance?.amount).toBe("75.00");

    // 6. Reconciliation contract checks
    const recon = await ctx.reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
    expect(recon.difference.amount).toBe("0.00");
    expect(recon.checkedEntries).toBeGreaterThanOrEqual(3); // Opening + Bet 1 + Bet 2
  });

  it("Segurança de Domínio: Deve rejeitar submissão de transação OPENING", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-no-opening",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    let err: any = null;
    try {
      await ctx.processWagerTxUseCase.execute({
        providerId: "prov-bad",
        externalTransactionId: "ext-opening-attempt",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "r-bad",
        gameId: "g-bad",
        kind: WagerTransactionKind.Opening,
        money: { amount: "100.00", currency: "BRL" },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("INTERNAL_OPERATION_NOT_ALLOWED");
  });

  it("SQS Envelope: Deve aceitar mensagens encapsuladas com envelope 'data'", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-sqs-envelope",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const sqsEnvelope = {
      messageId: "msg-sqs-env-1",
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "prov-sqs",
        externalTransactionId: "sqs-tx-1",
        idempotencyKey: "prov-sqs:sqs-tx-1",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-sqs",
        gameId: "game-sqs",
        kind: WagerTransactionKind.Bet,
        money: { amount: "20.00", currency: "BRL" },
      },
    };

    const res = await ctx.sqsConsumer.handleMessage({
      messageId: "msg-sqs-env-1",
      body: JSON.stringify(sqsEnvelope),
      receiptHandle: "handle-1",
    });

    expect(res.acknowledged).toBe(true);
    expect(res.alreadyProcessed).toBe(false);

    const updatedWallet = await ctx.getWalletUseCase.execute(wallet.id);
    expect(updatedWallet.balance.toJSON().amount).toBe("80.00");
  });

  it("Referências Fora de Ordem: Esgotado limite de tentativas deve transicionar para REJECTED", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-timeout",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    // Submit refund referencing a non-existent bet
    const refundRes = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-timeout",
      externalTransactionId: "refund-orphan",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-timeout",
      gameId: "game-timeout",
      kind: WagerTransactionKind.Refund,
      money: { amount: "15.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-never-arrives",
    });

    expect(refundRes.status).toBe(WagerTransactionStatus.PendingReference);

    // Run reconciler until maxAttempts (5)
    for (let i = 0; i < 5; i++) {
      await ctx.pendingReferenceReconciler.reconcilePendingTransactions();
    }

    const tx = await ctx.getTransactionUseCase.getById(refundRes.transaction.id);
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.rejectionReason).toBe("REFERENCE_NOT_FOUND");
  });
});
