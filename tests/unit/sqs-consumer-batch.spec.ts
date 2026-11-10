import { describe, it, expect } from "bun:test";
import { createTestContext } from "../test-helper";
import { SqsConsumer, type SqsMessage } from "../../src/infrastructure/messaging/sqs-consumer";
import { WagerTransactionKind } from "../../src/domain/models/wager-transaction";

describe("SqsConsumer - Paralelismo por MessageGroupId e Backoff de Visibilidade", () => {
  it("deve agrupar por MessageGroupId e processar carteiras em paralelo com ordem interna estrita", async () => {
    const ctx = await createTestContext();

    const walletA = await ctx.createWalletUseCase.execute({
      playerId: "player-batch-a",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const walletB = await ctx.createWalletUseCase.execute({
      playerId: "player-batch-b",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const messages: SqsMessage[] = [
      {
        messageId: "msg-a-1",
        messageGroupId: walletA.id,
        body: JSON.stringify({
          providerId: "prov-batch",
          externalTransactionId: "tx-a-1",
          playerId: walletA.playerId,
          walletId: walletA.id,
          roundId: "r1",
          gameId: "g1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "10.00", currency: "BRL" },
        }),
      },
      {
        messageId: "msg-b-1",
        messageGroupId: walletB.id,
        body: JSON.stringify({
          providerId: "prov-batch",
          externalTransactionId: "tx-b-1",
          playerId: walletB.playerId,
          walletId: walletB.id,
          roundId: "r2",
          gameId: "g1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "20.00", currency: "BRL" },
        }),
      },
      {
        messageId: "msg-a-2",
        messageGroupId: walletA.id,
        body: JSON.stringify({
          providerId: "prov-batch",
          externalTransactionId: "tx-a-2",
          playerId: walletA.playerId,
          walletId: walletA.id,
          roundId: "r1",
          gameId: "g1",
          kind: WagerTransactionKind.Win,
          money: { amount: "15.00", currency: "BRL" },
        }),
      },
    ];

    const results = await ctx.sqsConsumer.handleBatch(messages);
    expect(results.length).toBe(3);
    expect(results.every((r) => r.acknowledged)).toBe(true);

    const reconA = await ctx.reconcileWalletUseCase.execute(walletA.id);
    const reconB = await ctx.reconcileWalletUseCase.execute(walletB.id);

    expect(reconA.storedBalance.amount).toBe("105.00"); // 100 - 10 + 15
    expect(reconB.storedBalance.amount).toBe("80.00");  // 100 - 20
  });

  it("deve ajustar a visibilidade no SQS com backoff exponencial em falha transitória", async () => {
    let visibilityAdjusted: { receiptHandle: string; seconds: number } | null = null;

    const mockSqsClient = {
      deleteMessage: async () => {},
      changeMessageVisibility: async (receiptHandle: string, seconds: number) => {
        visibilityAdjusted = { receiptHandle, seconds };
      },
    };

    const ctx = await createTestContext();
    const consumer = new SqsConsumer(
      "test-visibility-consumer",
      ctx.transactionRunner,
      ctx.processWagerTxUseCase,
      mockSqsClient
    );

    const brokenMessage: SqsMessage = {
      messageId: "msg-fail",
      receiptHandle: "receipt-to-change",
      approximateReceiveCount: 3,
      body: JSON.stringify({
        providerId: "prov-fail",
        externalTransactionId: "tx-fail",
        playerId: "non-existent-player",
        walletId: "non-existent-wallet",
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "10.00", currency: "BRL" },
      }),
    };

    try {
      await consumer.handleMessage(brokenMessage);
    } catch {
      // Expected failure
    }

    expect(visibilityAdjusted).toBeDefined();
    expect(visibilityAdjusted!.receiptHandle).toBe("receipt-to-change");
    // attempt 3: 2^3 * 5 = 40 seconds
    expect(visibilityAdjusted!.seconds).toBe(40);
  });
});
