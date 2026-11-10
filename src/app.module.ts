import { Module } from "@nestjs/common";
import { WalletsController } from "./infrastructure/http/controllers/wallets.controller";
import { WageringController } from "./infrastructure/http/controllers/wagering.controller";
import { HealthController } from "./infrastructure/http/controllers/health.controller";
import { PostgresDatabaseService } from "./infrastructure/database/pg-database";
import { PgTransactionRunner } from "./infrastructure/database/pg-unit-of-work";
import { CreateWalletUseCase } from "./application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "./application/use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "./application/use-cases/reconcile-wallet.use-case";
import { GetWalletLedgerUseCase } from "./application/use-cases/get-wallet-ledger.use-case";
import { PendingReferenceReconciler } from "./infrastructure/messaging/pending-reference-reconciler";
import { OutboxPublisher } from "./infrastructure/messaging/outbox-publisher";

@Module({
  controllers: [WalletsController, WageringController, HealthController],
  providers: [
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
      provide: ProcessWagerTransactionUseCase,
      useFactory: (runner: PgTransactionRunner) => new ProcessWagerTransactionUseCase(runner),
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
  ],
})
export class AppModule {}

