import { Money, type MoneyProps } from "../../domain/models/money";
import { Wallet } from "../../domain/models/wallet";
import { WagerTransaction, WagerTransactionKind } from "../../domain/models/wager-transaction";
import { WalletLedgerEntry, LedgerDirection } from "../../domain/models/wallet-ledger-entry";
import { WalletBalanceChanged } from "../../domain/events/integration-events";
import { OutboxMessage } from "../../domain/models/outbox-message";
import { computeCanonicalPayloadHash } from "../../domain/utils/canonical-json";
import { DomainError } from "../../domain/errors/domain-error";
import type { ITransactionRunner, IUnitOfWork } from "../ports/unit-of-work.interface";

export interface CreateWalletDto {
  playerId: string;
  initialBalance: MoneyProps;
}

export class CreateWalletUseCase {
  constructor(private readonly transactionRunner: ITransactionRunner) {}

  public async execute(dto: CreateWalletDto, existingUow?: IUnitOfWork): Promise<Wallet> {
    const initialMoney = Money.from(dto.initialBalance);

    const work = async (uow: IUnitOfWork): Promise<Wallet> => {
      const existing = await uow.wallets.findByPlayerAndCurrency(
        dto.playerId,
        initialMoney.currency
      );
      if (existing) {
        throw new DomainError(
          `Wallet already exists for player ${dto.playerId} and currency ${initialMoney.currency}`,
          "WALLET_ALREADY_EXISTS"
        );
      }

      const walletId = crypto.randomUUID();
      const wallet = Wallet.open({
        id: walletId,
        playerId: dto.playerId,
        initialBalance: initialMoney,
      });

      await uow.wallets.save(wallet);

      if (initialMoney.isPositive()) {
        const openingTxId = crypto.randomUUID();
        const payloadHash = computeCanonicalPayloadHash({
          walletId,
          playerId: dto.playerId,
          initialBalance: dto.initialBalance,
        });

        const openingTx = WagerTransaction.create({
          id: openingTxId,
          providerId: "system",
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `system:opening:${walletId}`,
          payloadHash,
          walletId,
          playerId: dto.playerId,
          roundId: "system-opening",
          gameId: "system-opening",
          kind: WagerTransactionKind.Opening,
          money: initialMoney,
        });
        openingTx.markProcessed(undefined, wallet.createdAt);
        openingTx.recordObservedBalance(initialMoney);
        await uow.wagerTransactions.save(openingTx);

        const zero = Money.zero(initialMoney.currency);
        const ledgerEntry = WalletLedgerEntry.create({
          id: crypto.randomUUID(),
          walletId,
          transactionId: openingTxId,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: zero,
          balanceAfter: initialMoney,
          createdAt: wallet.createdAt,
        });
        await uow.ledger.save(ledgerEntry);

        const event = new WalletBalanceChanged({
          eventId: crypto.randomUUID(),
          aggregateId: walletId,
          occurredAt: wallet.createdAt,
          data: {
            walletId,
            transactionId: openingTxId,
            direction: LedgerDirection.Credit,
            money: initialMoney.toJSON(),
            balanceBefore: zero.toJSON(),
            balanceAfter: initialMoney.toJSON(),
            walletVersion: wallet.version,
          },
        });

        await uow.outbox.save(
          OutboxMessage.enqueue({
            id: event.eventId,
            aggregateId: walletId,
            eventType: event.eventType,
            payload: event.toJSON(),
            occurredAt: event.occurredAt,
          })
        );
      }

      return wallet;
    };

    if (existingUow) {
      return await work(existingUow);
    }
    return await this.transactionRunner.run(work);
  }
}
