import { Money, type MoneyProps } from "../../domain/models/money";
import { LedgerDirection } from "../../domain/models/wallet-ledger-entry";
import { DomainError } from "../../domain/errors/domain-error";
import { PrometheusService } from "../../infrastructure/observability/prometheus-metrics";
import { StructuredLogger } from "../../infrastructure/observability/logger";
import type { ITransactionRunner } from "../ports/unit-of-work.interface";

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
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
      const diffMoney = wallet.balance.isLessThan(calculated)
        ? calculated.subtract(wallet.balance)
        : wallet.balance.subtract(calculated);

      try {
        const prom = PrometheusService.getInstance();
        prom.reconciliationTotal.inc({ consistent: String(consistent) });
      } catch {
        // non-blocking
      }

      if (!consistent) {
        StructuredLogger.error("Wallet ledger reconciliation discrepancy detected!", undefined, {
          walletId,
          storedBalance: wallet.balance.toJSON(),
          calculatedBalance: calculated.toJSON(),
          difference: diffMoney.toJSON(),
        });
      }

      return {
        walletId,
        storedBalance: wallet.balance.toJSON(),
        calculatedBalance: calculated.toJSON(),
        difference: diffMoney.toJSON(),
        consistent,
        checkedEntries: ledgerEntries.length,
        ledgerEntriesCount: ledgerEntries.length,
        anomalyDetected: !consistent,
      };
    });
  }
}
