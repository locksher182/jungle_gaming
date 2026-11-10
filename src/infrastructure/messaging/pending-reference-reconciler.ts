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
  constructor(private readonly transactionRunner: ITransactionRunner) {}

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

        if (!refTx || refTx.status !== WagerTransactionStatus.Processed) {
          // Still waiting for reference transaction
          continue;
        }

        // Lock wallet
        const wallet = await uow.wallets.findByIdForUpdate(tx.walletId);
        if (!wallet) continue;

        // Check if reference already reversed
        const reversals = await uow.wagerTransactions.findReversalsForReference(
          tx.providerId,
          tx.referenceExternalTransactionId
        );
        if (reversals.length > 0) {
          tx.reject("TRANSACTION_ALREADY_REVERSED");
          await uow.wagerTransactions.save(tx);
          continue;
        }

        if (tx.kind === WagerTransactionKind.Refund) {
          const ledger = wallet.credit({ transactionId: tx.id, amount: tx.money });
          tx.markProcessed();

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
              await uow.wagerTransactions.save(tx);
              continue;
            }
            ledger = wallet.debit({ transactionId: tx.id, amount: tx.money });
          } else {
            tx.reject("CANNOT_ROLLBACK_KIND");
            await uow.wagerTransactions.save(tx);
            continue;
          }

          tx.markProcessed();
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

