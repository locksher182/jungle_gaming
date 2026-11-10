import { PGlite } from "@electric-sql/pglite";
import * as fs from "node:fs";
import * as path from "node:path";
import { PostgresDatabaseService } from "../src/infrastructure/database/pg-database";
import { PgTransactionRunner } from "../src/infrastructure/database/pg-unit-of-work";
import { CreateWalletUseCase } from "../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../src/application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "../src/application/use-cases/reconcile-wallet.use-case";
import { GetWalletLedgerUseCase } from "../src/application/use-cases/get-wallet-ledger.use-case";
import { GetWalletUseCase } from "../src/application/use-cases/get-wallet.use-case";
import { GetTransactionUseCase } from "../src/application/use-cases/get-transaction.use-case";
import { SqsConsumer } from "../src/infrastructure/messaging/sqs-consumer";
import { OutboxPublisher } from "../src/infrastructure/messaging/outbox-publisher";
import { PendingReferenceReconciler } from "../src/infrastructure/messaging/pending-reference-reconciler";

export interface TestContext {
  pglite: PGlite;
  dbService: PostgresDatabaseService;
  transactionRunner: PgTransactionRunner;
  createWalletUseCase: CreateWalletUseCase;
  processWagerTxUseCase: ProcessWagerTransactionUseCase;
  reconcileWalletUseCase: ReconcileWalletUseCase;
  getWalletLedgerUseCase: GetWalletLedgerUseCase;
  getWalletUseCase: GetWalletUseCase;
  getTransactionUseCase: GetTransactionUseCase;
  sqsConsumer: SqsConsumer;
  outboxPublisher: OutboxPublisher;
  pendingReferenceReconciler: PendingReferenceReconciler;
}

export async function createTestContext(): Promise<TestContext> {
  const pglite = new PGlite();
  const schemaPath = path.resolve(process.cwd(), "migrations", "001_initial_schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");
  await pglite.exec(schemaSql);

  const dbService = new PostgresDatabaseService({ pglite });
  const transactionRunner = new PgTransactionRunner(dbService);
  const createWalletUseCase = new CreateWalletUseCase(transactionRunner);
  const processWagerTxUseCase = new ProcessWagerTransactionUseCase(transactionRunner);
  const reconcileWalletUseCase = new ReconcileWalletUseCase(transactionRunner);
  const getWalletLedgerUseCase = new GetWalletLedgerUseCase(transactionRunner);
  const getWalletUseCase = new GetWalletUseCase(transactionRunner);
  const getTransactionUseCase = new GetTransactionUseCase(transactionRunner);
  const sqsConsumer = new SqsConsumer(
    "test-wager-consumer",
    transactionRunner,
    processWagerTxUseCase
  );
  const outboxPublisher = new OutboxPublisher(transactionRunner);
  const pendingReferenceReconciler = new PendingReferenceReconciler(transactionRunner);

  return {
    pglite,
    dbService,
    transactionRunner,
    createWalletUseCase,
    processWagerTxUseCase,
    reconcileWalletUseCase,
    getWalletLedgerUseCase,
    getWalletUseCase,
    getTransactionUseCase,
    sqsConsumer,
    outboxPublisher,
    pendingReferenceReconciler,
  };
}
