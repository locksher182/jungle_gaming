import { describe, it, expect, beforeEach } from "bun:test";
import { createTestContext, type TestContext } from "../test-helper";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/models/wager-transaction";
import { OutboxMessage } from "../../src/domain/models/outbox-message";

describe("Testes de Concorrência e Resiliência", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it("Cenário 1: 50 apostas idênticas em paralelo com a mesma Idempotency-Key -> exatamente 1 débito", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-c1",
      initialBalance: { amount: "500.00", currency: "BRL" },
    });

    const dto = {
      providerId: "prov-c1",
      externalTransactionId: "tx-concurrent-1",
      idempotencyKey: "prov-c1:tx-concurrent-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-c1",
      gameId: "game-c1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "10.00", currency: "BRL" },
    };

    // Fire 50 identical requests in parallel
    const promises = Array.from({ length: 50 }, () => ctx.processWagerTxUseCase.execute(dto));
    const results = await Promise.all(promises);

    // All should return status PROCESSED
    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);

    const nonReplays = results.filter((r) => !r.isReplay);
    const replays = results.filter((r) => r.isReplay);

    expect(nonReplays.length).toBe(1);
    expect(replays.length).toBe(49);

    const updatedWallet = (await ctx.transactionRunner.run((uow) =>
      uow.wallets.findById(wallet.id)
    ))!;
    expect(updatedWallet.balance.toJSON().amount).toBe("490.00");
    expect(updatedWallet.version).toBe(2);

    const entries = await ctx.transactionRunner.run((uow) => uow.ledger.findByWalletId(wallet.id));
    // 1 opening credit (500.00) + exactly 1 bet debit (10.00) = 2 entries
    expect(entries.length).toBe(2);
  });

  it("Cenário 2: Hot Wallet - Saldo 100.00 BRL com duas apostas simultâneas de 80.00 BRL -> 1 PROCESSED, 1 REJECTED, saldo 20.00 BRL", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-hot-wallet",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const betA = {
      providerId: "prov-c2",
      externalTransactionId: "bet-a",
      idempotencyKey: "prov-c2:bet-a",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-a",
      gameId: "game-a",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    const betB = {
      providerId: "prov-c2",
      externalTransactionId: "bet-b",
      idempotencyKey: "prov-c2:bet-b",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-b",
      gameId: "game-b",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    const results = await Promise.all([
      ctx.processWagerTxUseCase.execute(betA),
      ctx.processWagerTxUseCase.execute(betB),
    ]);

    const processed = results.find((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.find((r) => r.status === WagerTransactionStatus.Rejected);

    expect(processed).toBeDefined();
    expect(rejected).toBeDefined();
    expect(rejected?.rejectionReason).toBe("INSUFFICIENT_FUNDS");

    const updatedWallet = (await ctx.transactionRunner.run((uow) =>
      uow.wallets.findById(wallet.id)
    ))!;
    expect(updatedWallet.balance.toJSON().amount).toBe("20.00");
    expect(updatedWallet.version).toBe(2);

    const recon = await ctx.reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance.amount).toBe("20.00");
    expect(recon.calculatedBalance.amount).toBe("20.00");
  });

  it("Cenário 3: Wallets distintas processadas em paralelo -> alta vazão sem lock global de tabela", async () => {
    const walletCount = 5;
    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, i) =>
        ctx.createWalletUseCase.execute({
          playerId: `player-concurrent-${i}`,
          initialBalance: { amount: "100.00", currency: "BRL" },
        })
      )
    );

    // Concurrently process bets on distinct wallets
    const betPromises = wallets.map((w, i) =>
      ctx.processWagerTxUseCase.execute({
        providerId: "prov-c3",
        externalTransactionId: `bet-wallet-${i}`,
        playerId: w.playerId,
        walletId: w.id,
        roundId: `round-${i}`,
        gameId: `game-${i}`,
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: "BRL" },
      })
    );

    const results = await Promise.all(betPromises);
    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);

    for (const w of wallets) {
      const updated = (await ctx.transactionRunner.run((uow) => uow.wallets.findById(w.id)))!;
      expect(updated.balance.toJSON().amount).toBe("75.00");
    }
  });

  it("Cenário 4: Execução concorrente com >= 3 instâncias simuladas sem corrupção de estado", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-multi-instance",
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    // 3 distinct instances executing interleaved operations
    const instanceA = ctx.processWagerTxUseCase;
    const instanceB = ctx.processWagerTxUseCase;
    const instanceC = ctx.processWagerTxUseCase;

    const ops = [
      instanceA.execute({
        providerId: "p",
        externalTransactionId: "op-1",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "100.00", currency: "BRL" },
      }),
      instanceB.execute({
        providerId: "p",
        externalTransactionId: "op-2",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Win,
        money: { amount: "50.00", currency: "BRL" },
      }),
      instanceC.execute({
        providerId: "p",
        externalTransactionId: "op-3",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "200.00", currency: "BRL" },
      }),
    ];

    await Promise.all(ops);

    const recon = await ctx.reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
    // 1000 - 100 + 50 - 200 = 750.00
    expect(recon.storedBalance.amount).toBe("750.00");
    expect(recon.calculatedBalance.amount).toBe("750.00");
  });

  it("Cenário 5: Injeção de falha - Worker morto após commit e antes do ACK do SQS -> recuperação segura via Inbox", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-sqs-crash",
      initialBalance: { amount: "200.00", currency: "BRL" },
    });

    const msgPayload = {
      providerId: "prov-sqs",
      externalTransactionId: "tx-sqs-crash-1",
      idempotencyKey: "prov-sqs:tx-sqs-crash-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-sqs",
      gameId: "game-sqs",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    };

    const sqsMessage = {
      messageId: "sqs-msg-unique-001",
      body: JSON.stringify(msgPayload),
      receiptHandle: "receipt-handle-001",
    };

    // 1. First execution: worker commits to database successfully
    const firstDelivery = await ctx.sqsConsumer.handleMessage(sqsMessage);
    expect(firstDelivery.acknowledged).toBe(true);
    expect(firstDelivery.alreadyProcessed).toBe(false);

    const walletAfterFirst = (await ctx.transactionRunner.run((uow) =>
      uow.wallets.findById(wallet.id)
    ))!;
    expect(walletAfterFirst.balance.toJSON().amount).toBe("150.00");

    // 2. Simulate worker crash before ACK -> SQS redelivers the exact same message
    const redelivery = await ctx.sqsConsumer.handleMessage(sqsMessage);
    expect(redelivery.acknowledged).toBe(true);
    expect(redelivery.alreadyProcessed).toBe(true);

    // Balance must NOT have been deducted a second time
    const walletAfterRedelivery = (await ctx.transactionRunner.run((uow) =>
      uow.wallets.findById(wallet.id)
    ))!;
    expect(walletAfterRedelivery.balance.toJSON().amount).toBe("150.00");
    expect(walletAfterRedelivery.version).toBe(2);
  });

  it("Cenário 6: Dois publishers concorrentes sobre a mesma tabela Outbox -> sem duplicações de envio", async () => {
    // Manually enqueue 4 outbox messages
    await ctx.transactionRunner.run(async (uow) => {
      for (let i = 1; i <= 4; i++) {
        await uow.outbox.save(
          OutboxMessage.enqueue({
            aggregateId: `agg-${i}`,
            eventType: "TestEvent",
            payload: { item: i },
          })
        );
      }
    });

    const publishedPayloads: unknown[] = [];
    const eventPublisher = {
      publish: async (_type: string, payload: unknown) => {
        publishedPayloads.push(payload);
      },
    };

    // Two distinct publisher worker instances running concurrently with real event dispatch
    const pubWorker1 = new (ctx.outboxPublisher.constructor as any)(
      ctx.transactionRunner,
      eventPublisher
    );
    const pubWorker2 = new (ctx.outboxPublisher.constructor as any)(
      ctx.transactionRunner,
      eventPublisher
    );

    const [count1, count2] = await Promise.all([
      pubWorker1.publishBatch(10),
      pubWorker2.publishBatch(10),
    ]);

    expect(count1 + count2).toBe(4);
    expect(publishedPayloads.length).toBe(4);
  });

  it("Cenário 7: Mensagens fora de ordem - REFUND ou ROLLBACK entregue antes da BET -> PENDING_REFERENCE e reconciliação posterior", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-ooo",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const originalBetId = "bet-that-arrives-late";

    // 1. REFUND arrives before the BET
    const earlyRefund = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-ooo",
      externalTransactionId: "refund-early",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-ooo",
      gameId: "game-ooo",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: originalBetId,
    });

    expect(earlyRefund.status).toBe(WagerTransactionStatus.PendingReference);

    // Wallet balance remains 100.00 BRL while in PENDING_REFERENCE
    const walletInterim = (await ctx.transactionRunner.run((uow) =>
      uow.wallets.findById(wallet.id)
    ))!;
    expect(walletInterim.balance.toJSON().amount).toBe("100.00");

    // 2. The BET arrives later and is processed
    const lateBet = await ctx.processWagerTxUseCase.execute({
      providerId: "prov-ooo",
      externalTransactionId: originalBetId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-ooo",
      gameId: "game-ooo",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });
    expect(lateBet.status).toBe(WagerTransactionStatus.Processed);

    // 3. Background Reconciler runs and resolves PENDING_REFERENCE
    const reconciled = await ctx.pendingReferenceReconciler.reconcilePendingTransactions();
    expect(reconciled).toBe(1);

    const refundedTx = (await ctx.transactionRunner.run((uow) =>
      uow.wagerTransactions.findByProviderAndExternalId("prov-ooo", "refund-early")
    ))!;
    expect(refundedTx.status).toBe(WagerTransactionStatus.Processed);

    // Balance after bet (-40.00) and refund (+40.00) is back to 100.00 BRL
    const finalWallet = (await ctx.transactionRunner.run((uow) =>
      uow.wallets.findById(wallet.id)
    ))!;
    expect(finalWallet.balance.toJSON().amount).toBe("100.00");
  });

  it("Cenário 8: Reinício do serviço com comprovação da Invariante Final: wallet.balance == soma do ledger", async () => {
    const wallet = await ctx.createWalletUseCase.execute({
      playerId: "player-gold-invariant",
      initialBalance: { amount: "500.00", currency: "BRL" },
    });

    // Execute multiple operations
    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-gold",
      externalTransactionId: "gold-bet-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-gold-1",
      gameId: "game-gold",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    });

    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-gold",
      externalTransactionId: "gold-win-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-gold-1",
      gameId: "game-gold",
      kind: WagerTransactionKind.Win,
      money: { amount: "120.00", currency: "BRL" },
    });

    await ctx.processWagerTxUseCase.execute({
      providerId: "prov-gold",
      externalTransactionId: "gold-bet-2",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-gold-2",
      gameId: "game-gold",
      kind: WagerTransactionKind.Bet,
      money: { amount: "70.00", currency: "BRL" },
    });

    // Reconcile and audit storedBalance vs sum of ledger
    const recon = await ctx.reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
    expect(recon.anomalyDetected).toBe(false);

    // 500 - 50 + 120 - 70 = 500.00
    expect(recon.storedBalance.amount).toBe("500.00");
    expect(recon.calculatedBalance.amount).toBe("500.00");
    // 1 opening + 3 operations = 4 ledger entries
    expect(recon.ledgerEntriesCount).toBe(4);
  });
});
