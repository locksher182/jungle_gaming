import type { IDatabaseService, SqlExecutor } from "./database.interface";
import type {
  ITransactionRunner,
  IUnitOfWork,
} from "../../application/ports/unit-of-work.interface";
import { PgWalletRepository } from "./repositories/pg-wallet-repository";
import { PgWagerTransactionRepository } from "./repositories/pg-wager-transaction-repository";
import { PgWalletLedgerRepository } from "./repositories/pg-wallet-ledger-repository";
import { PgInboxRepository } from "./repositories/pg-inbox-repository";
import { PgOutboxRepository } from "./repositories/pg-outbox-repository";

export class PgUnitOfWork implements IUnitOfWork {
  public readonly wallets: PgWalletRepository;
  public readonly wagerTransactions: PgWagerTransactionRepository;
  public readonly ledger: PgWalletLedgerRepository;
  public readonly inbox: PgInboxRepository;
  public readonly outbox: PgOutboxRepository;

  constructor(client: SqlExecutor) {
    this.wallets = new PgWalletRepository(client);
    this.wagerTransactions = new PgWagerTransactionRepository(client);
    this.ledger = new PgWalletLedgerRepository(client);
    this.inbox = new PgInboxRepository(client);
    this.outbox = new PgOutboxRepository(client);
  }
}

export class PgTransactionRunner implements ITransactionRunner {
  constructor(private readonly db: IDatabaseService) {}

  public async run<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (client) => {
      const uow = new PgUnitOfWork(client);
      return await work(uow);
    });
  }
}
