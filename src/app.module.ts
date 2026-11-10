import { Module } from "@nestjs/common";
import { WalletsController } from "./infrastructure/http/controllers/wallets.controller";
import { WageringController } from "./infrastructure/http/controllers/wagering.controller";
import { ProvidersController } from "./infrastructure/http/controllers/providers.controller";
import { HealthController } from "./infrastructure/http/controllers/health.controller";
import { MetricsController } from "./infrastructure/http/controllers/metrics.controller";
import { PostgresDatabaseService } from "./infrastructure/database/pg-database";
import { PgTransactionRunner } from "./infrastructure/database/pg-unit-of-work";
import { CreateWalletUseCase } from "./application/use-cases/create-wallet.use-case";
import { GetWalletUseCase } from "./application/use-cases/get-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "./application/use-cases/process-wager-transaction.use-case";
import { GetTransactionUseCase } from "./application/use-cases/get-transaction.use-case";
import { ReconcileWalletUseCase } from "./application/use-cases/reconcile-wallet.use-case";
import { GetWalletLedgerUseCase } from "./application/use-cases/get-wallet-ledger.use-case";
import { PendingReferenceReconciler } from "./infrastructure/messaging/pending-reference-reconciler";
import { OutboxPublisher } from "./infrastructure/messaging/outbox-publisher";
import { RealSqsClient } from "./infrastructure/messaging/sqs-client";
import { SqsConsumer } from "./infrastructure/messaging/sqs-consumer";
import { BackgroundWorkerService } from "./infrastructure/messaging/background-worker.service";
import { NoOpAuthGuard } from "./infrastructure/http/guards/noop-auth.guard";

@Module({
  controllers: [
    WalletsController,
    WageringController,
    ProvidersController,
    HealthController,
    MetricsController,
  ],
  providers: [
    NoOpAuthGuard,
    {
      provide: PostgresDatabaseService,
      useFactory: () => {
        const connectionString =
          process.env.DATABASE_URL || "postgres://jg_user:jg_password@localhost:5432/jg_db";
        return new PostgresDatabaseService({ connectionString });
      },
    },
    {
      provide: PgTransactionRunner,
      useFactory: (db: PostgresDatabaseService) => new PgTransactionRunner(db),
      inject: [PostgresDatabaseService],
    },
    {
      provide: CreateWalletUseCase,
      useFactory: (runner: PgTransactionRunner) => new CreateWalletUseCase(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: GetWalletUseCase,
      useFactory: (runner: PgTransactionRunner) => new GetWalletUseCase(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: ProcessWagerTransactionUseCase,
      useFactory: (runner: PgTransactionRunner) => new ProcessWagerTransactionUseCase(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: GetTransactionUseCase,
      useFactory: (runner: PgTransactionRunner) => new GetTransactionUseCase(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (runner: PgTransactionRunner) => new ReconcileWalletUseCase(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: GetWalletLedgerUseCase,
      useFactory: (runner: PgTransactionRunner) => new GetWalletLedgerUseCase(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: PendingReferenceReconciler,
      useFactory: (runner: PgTransactionRunner) => new PendingReferenceReconciler(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: OutboxPublisher,
      useFactory: (runner: PgTransactionRunner) => new OutboxPublisher(runner),
      inject: [PgTransactionRunner],
    },
    {
      provide: RealSqsClient,
      useFactory: () => new RealSqsClient(),
    },
    {
      provide: SqsConsumer,
      useFactory: (
        runner: PgTransactionRunner,
        useCase: ProcessWagerTransactionUseCase,
        sqsClient: RealSqsClient
      ) => new SqsConsumer("prod-wager-consumer", runner, useCase, sqsClient),
      inject: [PgTransactionRunner, ProcessWagerTransactionUseCase, RealSqsClient],
    },
    {
      provide: BackgroundWorkerService,
      useFactory: (
        sqsConsumer: SqsConsumer,
        sqsClient: RealSqsClient,
        outboxPublisher: OutboxPublisher,
        reconciler: PendingReferenceReconciler
      ) => new BackgroundWorkerService(sqsConsumer, sqsClient, outboxPublisher, reconciler),
      inject: [SqsConsumer, RealSqsClient, OutboxPublisher, PendingReferenceReconciler],
    },
  ],
})
export class AppModule {}
