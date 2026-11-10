import { Money, type MoneyProps } from "../../domain/models/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/models/wager-transaction";
import type { WalletLedgerEntry } from "../../domain/models/wallet-ledger-entry";
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from "../../domain/events/integration-events";
import { OutboxMessage } from "../../domain/models/outbox-message";
import { computeCanonicalPayloadHash } from "../../domain/utils/canonical-json";
import { DomainError } from "../../domain/errors/domain-error";
import type { ITransactionRunner, IUnitOfWork } from "../ports/unit-of-work.interface";

export interface ProcessWagerTransactionDto {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey?: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionResult {
  transaction: WagerTransaction;
  isReplay: boolean;
  status: WagerTransactionStatus;
  rejectionReason?: string;
}

export class ProcessWagerTransactionUseCase {
  constructor(private readonly transactionRunner: ITransactionRunner) {}

  public async execute(
    dto: ProcessWagerTransactionDto,
    existingUow?: IUnitOfWork
  ): Promise<ProcessWagerTransactionResult> {
    const money = Money.from(dto.money);
    const idempotencyKey =
      dto.idempotencyKey?.trim() || `${dto.providerId}:${dto.externalTransactionId}`;

    const canonicalPayload = {
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: dto.money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId ?? null,
    };
    const payloadHash = computeCanonicalPayloadHash(canonicalPayload);

    const work = async (uow: IUnitOfWork): Promise<ProcessWagerTransactionResult> => {
      // 1. Check idempotency
      const existing = await uow.wagerTransactions.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.matchesPayload(payloadHash)) {
          return {
            transaction: existing,
            isReplay: true,
            status: existing.status,
            rejectionReason: existing.rejectionReason,
          };
        }
        throw new DomainError(
          `Idempotency-Key "${idempotencyKey}" already used with different payload`,
          "IDEMPOTENCY_CONFLICT"
        );
      }

      // 2. Lock wallet
      const wallet = await uow.wallets.findByIdForUpdate(dto.walletId);
      if (!wallet) {
        throw new DomainError(`Wallet "${dto.walletId}" not found`, "WALLET_NOT_FOUND");
      }
      if (wallet.playerId !== dto.playerId) {
        throw new DomainError(
          `Player "${dto.playerId}" does not match wallet owner "${wallet.playerId}"`,
          "PLAYER_MISMATCH"
        );
      }
      if (wallet.currency !== money.currency) {
        throw new DomainError(
          `Currency mismatch: wallet is ${wallet.currency}, transaction is ${money.currency}`,
          "CURRENCY_MISMATCH"
        );
      }

      const txId = crypto.randomUUID();
      const tx = WagerTransaction.create({
        id: txId,
        providerId: dto.providerId,
        externalTransactionId: dto.externalTransactionId,
        idempotencyKey,
        payloadHash,
        walletId: dto.walletId,
        playerId: dto.playerId,
        roundId: dto.roundId,
        gameId: dto.gameId,
        kind: dto.kind,
        money,
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
      });

      // 3. Dispatch by Kind
      switch (dto.kind) {
        case WagerTransactionKind.Bet: {
          if (wallet.balance.isLessThan(money)) {
            tx.reject("INSUFFICIENT_FUNDS");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "INSUFFICIENT_FUNDS");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "INSUFFICIENT_FUNDS",
            };
          }

          const ledger = wallet.debit({ transactionId: tx.id, amount: money });
          tx.markProcessed();

          await uow.wallets.save(wallet);
          await uow.ledger.save(ledger);
          await uow.wagerTransactions.save(tx);

          await this.enqueueBalanceChangedEvent(uow, wallet, tx, ledger);
          await this.enqueueProcessedEvent(uow, tx);

          return {
            transaction: tx,
            isReplay: false,
            status: WagerTransactionStatus.Processed,
          };
        }

        case WagerTransactionKind.Win: {
          const ledger = wallet.credit({ transactionId: tx.id, amount: money });
          tx.markProcessed();

          await uow.wallets.save(wallet);
          await uow.ledger.save(ledger);
          await uow.wagerTransactions.save(tx);

          await this.enqueueBalanceChangedEvent(uow, wallet, tx, ledger);
          await this.enqueueProcessedEvent(uow, tx);

          return {
            transaction: tx,
            isReplay: false,
            status: WagerTransactionStatus.Processed,
          };
        }

        case WagerTransactionKind.Loss: {
          tx.markProcessed();
          await uow.wagerTransactions.save(tx);
          await this.enqueueProcessedEvent(uow, tx);

          return {
            transaction: tx,
            isReplay: false,
            status: WagerTransactionStatus.Processed,
          };
        }

        case WagerTransactionKind.Refund: {
          const refTx = await uow.wagerTransactions.findByProviderAndExternalId(
            dto.providerId,
            dto.referenceExternalTransactionId!
          );

          if (!refTx) {
            tx.markPendingReference();
            await uow.wagerTransactions.save(tx);
            await this.enqueuePendingReferenceEvent(uow, tx, dto.referenceExternalTransactionId!);
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.PendingReference,
            };
          }

          if (refTx.status !== WagerTransactionStatus.Processed) {
            tx.reject("REFERENCE_NOT_PROCESSED");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "REFERENCE_NOT_PROCESSED");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "REFERENCE_NOT_PROCESSED",
            };
          }

          if (
            refTx.kind !== WagerTransactionKind.Bet ||
            refTx.playerId !== dto.playerId ||
            refTx.walletId !== dto.walletId ||
            refTx.roundId !== dto.roundId ||
            !refTx.money.equals(money)
          ) {
            tx.reject("INVALID_REFERENCE");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "INVALID_REFERENCE");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "INVALID_REFERENCE",
            };
          }

          const reversals = await uow.wagerTransactions.findReversalsForReference(
            dto.providerId,
            dto.referenceExternalTransactionId!
          );
          if (reversals.length > 0) {
            tx.reject("TRANSACTION_ALREADY_REVERSED");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "TRANSACTION_ALREADY_REVERSED");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "TRANSACTION_ALREADY_REVERSED",
            };
          }

          const ledger = wallet.credit({ transactionId: tx.id, amount: money });
          tx.markProcessed();

          await uow.wallets.save(wallet);
          await uow.ledger.save(ledger);
          await uow.wagerTransactions.save(tx);

          await this.enqueueBalanceChangedEvent(uow, wallet, tx, ledger);
          await this.enqueueProcessedEvent(uow, tx);

          return {
            transaction: tx,
            isReplay: false,
            status: WagerTransactionStatus.Processed,
          };
        }

        case WagerTransactionKind.Rollback: {
          const refTx = await uow.wagerTransactions.findByProviderAndExternalId(
            dto.providerId,
            dto.referenceExternalTransactionId!
          );

          if (!refTx) {
            tx.markPendingReference();
            await uow.wagerTransactions.save(tx);
            await this.enqueuePendingReferenceEvent(uow, tx, dto.referenceExternalTransactionId!);
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.PendingReference,
            };
          }

          if (refTx.status !== WagerTransactionStatus.Processed) {
            tx.reject("REFERENCE_NOT_PROCESSED");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "REFERENCE_NOT_PROCESSED");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "REFERENCE_NOT_PROCESSED",
            };
          }

          if (
            refTx.playerId !== dto.playerId ||
            refTx.walletId !== dto.walletId ||
            refTx.roundId !== dto.roundId ||
            !refTx.money.equals(money)
          ) {
            tx.reject("INVALID_REFERENCE");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "INVALID_REFERENCE");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "INVALID_REFERENCE",
            };
          }

          const reversals = await uow.wagerTransactions.findReversalsForReference(
            dto.providerId,
            dto.referenceExternalTransactionId!
          );
          if (reversals.length > 0) {
            tx.reject("TRANSACTION_ALREADY_REVERSED");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "TRANSACTION_ALREADY_REVERSED");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "TRANSACTION_ALREADY_REVERSED",
            };
          }

          let ledger: WalletLedgerEntry;
          if (refTx.kind === WagerTransactionKind.Bet) {
            ledger = wallet.credit({ transactionId: tx.id, amount: money });
          } else if (
            refTx.kind === WagerTransactionKind.Win ||
            refTx.kind === WagerTransactionKind.Refund
          ) {
            if (wallet.balance.isLessThan(money)) {
              tx.reject("REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE");
              await uow.wagerTransactions.save(tx);
              await this.enqueueRejectedEvent(uow, tx, "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE");
              return {
                transaction: tx,
                isReplay: false,
                status: WagerTransactionStatus.Rejected,
                rejectionReason: "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE",
              };
            }
            ledger = wallet.debit({ transactionId: tx.id, amount: money });
          } else {
            tx.reject("CANNOT_ROLLBACK_KIND");
            await uow.wagerTransactions.save(tx);
            await this.enqueueRejectedEvent(uow, tx, "CANNOT_ROLLBACK_KIND");
            return {
              transaction: tx,
              isReplay: false,
              status: WagerTransactionStatus.Rejected,
              rejectionReason: "CANNOT_ROLLBACK_KIND",
            };
          }

          tx.markProcessed();
          await uow.wallets.save(wallet);
          await uow.ledger.save(ledger);
          await uow.wagerTransactions.save(tx);

          await this.enqueueBalanceChangedEvent(uow, wallet, tx, ledger);
          await this.enqueueProcessedEvent(uow, tx);

          return {
            transaction: tx,
            isReplay: false,
            status: WagerTransactionStatus.Processed,
          };
        }

        default:
          throw new DomainError(`Unsupported transaction kind: ${dto.kind}`);
      }
    };

    if (existingUow) {
      return await work(existingUow);
    }
    return await this.transactionRunner.run(work);
  }

  private async enqueueBalanceChangedEvent(
    uow: any,
    wallet: any,
    tx: WagerTransaction,
    ledger: WalletLedgerEntry
  ): Promise<void> {
    const event = new WalletBalanceChanged({
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
        id: event.eventId,
        aggregateId: wallet.id,
        eventType: event.eventType,
        payload: event.toJSON(),
        occurredAt: event.occurredAt,
      })
    );
  }

  private async enqueueProcessedEvent(uow: any, tx: WagerTransaction): Promise<void> {
    const event = new WagerTransactionProcessed({
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
        id: event.eventId,
        aggregateId: tx.id,
        eventType: event.eventType,
        payload: event.toJSON(),
        occurredAt: event.occurredAt,
      })
    );
  }

  private async enqueueRejectedEvent(
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

  private async enqueuePendingReferenceEvent(
    uow: any,
    tx: WagerTransaction,
    referenceExternalTransactionId: string
  ): Promise<void> {
    const event = new WagerTransactionPendingReference({
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
        referenceExternalTransactionId,
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
}
