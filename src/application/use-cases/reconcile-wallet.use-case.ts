import { Money, type MoneyProps } from "../../domain/models/money";
import { LedgerDirection } from "../../domain/models/wallet-ledger-entry";
import { DomainError } from "../../domain/errors/domain-error";
import type { ITransactionRunner } from "../ports/unit-of-work.interface";

export interface ReconcileWalletResult {
  walletId: string;
  consistent: boolean;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  ledgerEntriesCount: number;
  anomalyDetected: boolean;
}

export class ReconcileWalletUseCase {
  constructor(private readonly transactionRunner: ITransactionRunner) {}

  public async execute(walletId: string): Promise<ReconcileWalletResult> {
    return await this.transactionRunner.run(async (uow) => {
      const wallet = await uow.wallets.findById(walletId);
      if (!wallet) {
        throw new DomainError(`Wallet "${walletId}" not found`, "WALLET_NOT_FOUND");
      }

      const ledgerEntries = await uow.ledger.findByWalletId(walletId);

      let calculated = Money.zero(wallet.currency);
      for (const entry of ledgerEntries) {
        if (entry.direction === LedgerDirection.Credit) {
          calculated = calculated.add(entry.money);
        } else if (entry.direction === LedgerDirection.Debit) {
          calculated = calculated.subtract(entry.money);
        }
      }

      const consistent = wallet.balance.equals(calculated);

      return {
        walletId,
        consistent,
        storedBalance: wallet.balance.toJSON(),
        calculatedBalance: calculated.toJSON(),
        ledgerEntriesCount: ledgerEntries.length,
        anomalyDetected: !consistent,
      };
    });
  }
}
