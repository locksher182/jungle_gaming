import { describe, it, expect } from "bun:test";
import { InboxMessage } from "../../src/domain/models/inbox-message";
import { OutboxMessage } from "../../src/domain/models/outbox-message";

describe("Transactional Inbox & Outbox (Unit Tests)", () => {
  describe("InboxMessage", () => {
    it("deve criar mensagem de inbox pendente e marcar como processada", () => {
      const inbox = InboxMessage.receive({
        messageId: "sqs-msg-101",
        consumerName: "wager-consumer",
        payloadHash: "hash-payload-101",
      });

      expect(inbox.isProcessed()).toBe(false);

      const processedDate = new Date();
      inbox.markProcessed(processedDate);

      expect(inbox.isProcessed()).toBe(true);
      expect(inbox.processedAt).toEqual(processedDate);
    });
  });

  describe("OutboxMessage", () => {
    it("deve agendar tentativas com backoff e marcar publicação", () => {
      const outbox = OutboxMessage.enqueue({
        id: "outbox-1",
        aggregateId: "wallet-1",
        eventType: "WalletBalanceChanged",
        payload: { walletId: "wallet-1", amount: "50.00" },
        occurredAt: new Date(),
      });

      expect(outbox.isPending()).toBe(true);
      expect(outbox.attempts).toBe(0);

      const now = new Date();
      outbox.scheduleRetry(now);

      expect(outbox.attempts).toBe(1);
      expect(outbox.nextAttemptAt).toBeDefined();
      expect(outbox.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());

      outbox.markPublished(new Date());
      expect(outbox.isPending()).toBe(false);
      expect(outbox.publishedAt).toBeDefined();
    });
  });
});
