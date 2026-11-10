import type { IWalletRepository } from "../../domain/repositories/wallet-repository.interface";
import type { IWagerTransactionRepository } from "../../domain/repositories/wager-transaction-repository.interface";
import type { IWalletLedgerRepository } from "../../domain/repositories/wallet-ledger-repository.interface";
import type { IInboxRepository } from "../../domain/repositories/inbox-repository.interface";
import type { IOutboxRepository } from "../../domain/repositories/outbox-repository.interface";

export interface IUnitOfWork {
  wallets: IWalletRepository;
  wagerTransactions: IWagerTransactionRepository;
  ledger: IWalletLedgerRepository;
  inbox: IInboxRepository;
  outbox: IOutboxRepository;
}

export interface ITransactionRunner {
  run<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T>;
}
