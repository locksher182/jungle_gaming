import type { ITransactionRunner } from "../../application/ports/unit-of-work.interface";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  type WagerTransaction,
} from "../../domain/models/wager-transaction";
import { LedgerDirection, WalletLedgerEntry } from "../../domain/models/wallet-ledger-entry";
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from "../../domain/events/integration-events";
import { OutboxMessage } from "../../domain/models/outbox-message";

export class PendingReferenceReconciler {
  constructor(
    private readonly transactionRunner: ITransactionRunner,
    private readonly maxAttempts: number = 5
  ) {}

  public async reconcilePendingTransactions(batchLimit: number = 50): Promise<number> {
    return await this.transactionRunner.run(async (uow) => {
      const pendingTxs = await uow.wagerTransactions.findPendingReferences(batchLimit);
      let reconciledCount = 0;

      for (const tx of pendingTxs) {
        if (!tx.referenceExternalTransactionId) continue;

        const refTx = await uow.wagerTransactions.findByProviderAndExternalId(
          tx.providerId,
          tx.referenceExternalTransactionId
        );

        // 1. If reference transaction still doesn't exist or is not PROCESSED
        if (!refTx || refTx.status !== WagerTransactionStatus.Processed) {
          const attempts = tx.incrementPendingAttempts();
          if (attempts >= this.maxAttempts) {
            tx.reject("REFERENCE_NOT_FOUND");
            await uow.wagerTransactions.save(tx);
            await this.publishRejectedEvent(uow, tx, "REFERENCE_NOT_FOUND");
          } else {
            await uow.wagerTransactions.save(tx);
          }
          continue;
        }

        // Lock wallet
        const wallet = await uow.wallets.findByIdForUpdate(tx.walletId);
        if (!wallet) continue;

        // 2. Re-validate domain rules against the reference transaction (prevents invalid out-of-order executions)
        if (
          refTx.playerId !== tx.playerId ||
          refTx.walletId !== tx.walletId ||
          refTx.roundId !== tx.roundId ||
          !refTx.money.equals(tx.money)
        ) {
          tx.reject("INVALID_REFERENCE");
          tx.recordObservedBalance(wallet.balance);
          await uow.wagerTransactions.save(tx);
          await this.publishRejectedEvent(uow, tx, "INVALID_REFERENCE");
          continue;
        }

        // 3. Kind-specific validations
        if (tx.kind === WagerTransactionKind.Refund && refTx.kind !== WagerTransactionKind.Bet) {
          tx.reject("INVALID_REFERENCE");
          tx.recordObservedBalance(wallet.balance);
          await uow.wagerTransactions.save(tx);
          await this.publishRejectedEvent(uow, tx, "INVALID_REFERENCE");
          continue;
        }

        if (
          tx.kind === WagerTransactionKind.Rollback &&
          refTx.kind !== WagerTransactionKind.Bet &&
          refTx.kind !== WagerTransactionKind.Win &&
          refTx.kind !== WagerTransactionKind.Refund
        ) {
          tx.reject("CANNOT_ROLLBACK_KIND");
          tx.recordObservedBalance(wallet.balance);
          await uow.wagerTransactions.save(tx);
          await this.publishRejectedEvent(uow, tx, "CANNOT_ROLLBACK_KIND");
          continue;
        }

        // 4. Check if reference was already reversed by the same operation kind
        const reversals = await uow.wagerTransactions.findReversalsForReference(
          tx.providerId,
          tx.referenceExternalTransactionId
        );
        const duplicateReversal = reversals.find((r) => r.kind === tx.kind);
        if (duplicateReversal) {
          tx.reject("TRANSACTION_ALREADY_REVERSED");
          tx.recordObservedBalance(wallet.balance);
          await uow.wagerTransactions.save(tx);
          await this.publishRejectedEvent(uow, tx, "TRANSACTION_ALREADY_REVERSED");
          continue;
        }

        // 5. Apply balance mutations and ledger records
        if (tx.kind === WagerTransactionKind.Refund) {
          const ledger = wallet.credit({ transactionId: tx.id, amount: tx.money });
          tx.markProcessed(refTx.id);
          tx.recordObservedBalance(wallet.balance);

          await uow.wallets.save(wallet);
          await uow.ledger.save(ledger);
          await uow.wagerTransactions.save(tx);

          await this.publishEvents(uow, wallet, tx, ledger);
          reconciledCount++;
        } else if (tx.kind === WagerTransactionKind.Rollback) {
          let ledger: WalletLedgerEntry;
          if (refTx.kind === WagerTransactionKind.Bet) {
            ledger = wallet.credit({ transactionId: tx.id, amount: tx.money });
          } else if (
            refTx.kind === WagerTransactionKind.Win ||
            refTx.kind === WagerTransactionKind.Refund
          ) {
            if (wallet.balance.isLessThan(tx.money)) {
              tx.reject("REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE");
              tx.recordObservedBalance(wallet.balance);
              await uow.wagerTransactions.save(tx);
              await this.publishRejectedEvent(uow, tx, "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE");
              continue;
            }
            ledger = wallet.debit({ transactionId: tx.id, amount: tx.money });
          } else {
            tx.reject("CANNOT_ROLLBACK_KIND");
            tx.recordObservedBalance(wallet.balance);
            await uow.wagerTransactions.save(tx);
            await this.publishRejectedEvent(uow, tx, "CANNOT_ROLLBACK_KIND");
            continue;
          }

          tx.markProcessed(refTx.id);
          tx.recordObservedBalance(wallet.balance);
          await uow.wallets.save(wallet);
          await uow.ledger.save(ledger);
          await uow.wagerTransactions.save(tx);

          await this.publishEvents(uow, wallet, tx, ledger);
          reconciledCount++;
        }
      }

      return reconciledCount;
    });
  }

  private async publishRejectedEvent(
    uow: any,
    tx: WagerTransaction,
    reason: string
  ): Promise<void> {
    const event = new WagerTransactionRejected({
      eventId: crypto.randomUUID(),
      aggregateId: tx.id,
      occurredAt: tx.updatedAt,
      data: {
        transactionId: tx.id,
        walletId: tx.walletId,
        playerId: tx.playerId,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        reason,
      },
    });
    await uow.outbox.save(
      OutboxMessage.enqueue({
        id: event.eventId,
        aggregateId: tx.id,
        eventType: event.eventType,
        payload: event.toJSON(),
        occurredAt: event.occurredAt,
      })
    );
  }

  private async publishEvents(
    uow: any,
    wallet: any,
    tx: WagerTransaction,
    ledger: WalletLedgerEntry
  ): Promise<void> {
    const balanceEvt = new WalletBalanceChanged({
      eventId: crypto.randomUUID(),
      aggregateId: wallet.id,
      occurredAt: tx.updatedAt,
      data: {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: ledger.direction,
        money: ledger.money.toJSON(),
        balanceBefore: ledger.balanceBefore.toJSON(),
        balanceAfter: ledger.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
    await uow.outbox.save(
      OutboxMessage.enqueue({
        id: balanceEvt.eventId,
        aggregateId: wallet.id,
        eventType: balanceEvt.eventType,
        payload: balanceEvt.toJSON(),
        occurredAt: balanceEvt.occurredAt,
      })
    );

    const procEvt = new WagerTransactionProcessed({
      eventId: crypto.randomUUID(),
      aggregateId: tx.id,
      occurredAt: tx.processedAt ?? tx.updatedAt,
      data: {
        transactionId: tx.id,
        walletId: tx.walletId,
        playerId: tx.playerId,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
      },
    });
    await uow.outbox.save(
      OutboxMessage.enqueue({
        id: procEvt.eventId,
        aggregateId: tx.id,
        eventType: procEvt.eventType,
        payload: procEvt.toJSON(),
        occurredAt: procEvt.occurredAt,
      })
    );
  }
}
