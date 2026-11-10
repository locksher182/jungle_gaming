import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import {
  CreateWalletUseCase,
  type CreateWalletDto,
} from "../../../application/use-cases/create-wallet.use-case";
import { ReconcileWalletUseCase } from "../../../application/use-cases/reconcile-wallet.use-case";
import { GetWalletLedgerUseCase } from "../../../application/use-cases/get-wallet-ledger.use-case";
import { GetWalletUseCase } from "../../../application/use-cases/get-wallet.use-case";
import { NoOpAuthGuard } from "../guards/noop-auth.guard";

@Controller("wallets")
@UseGuards(NoOpAuthGuard)
export class WalletsController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
    private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
    private readonly getWalletUseCase: GetWalletUseCase
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED) // 201
  public async createWallet(@Body() body: CreateWalletDto) {
    const wallet = await this.createWalletUseCase.execute(body);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  @Get(":walletId")
  @HttpCode(HttpStatus.OK) // 200
  public async getWallet(@Param("walletId") walletId: string) {
    const wallet = await this.getWalletUseCase.execute(walletId);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK) // 200
  public async reconcileWallet(@Param("walletId") walletId: string) {
    const result = await this.reconcileWalletUseCase.execute(walletId);
    return {
      walletId: result.walletId,
      storedBalance: result.storedBalance,
      calculatedBalance: result.calculatedBalance,
      difference: result.difference,
      consistent: result.consistent,
      checkedEntries: result.checkedEntries,
      ledgerEntriesCount: result.ledgerEntriesCount,
      anomalyDetected: result.anomalyDetected,
    };
  }

  @Get(":walletId/ledger")
  @HttpCode(HttpStatus.OK) // 200
  public async getLedger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const result = await this.getWalletLedgerUseCase.execute({
      walletId,
      cursor,
      limit: parsedLimit,
    });

    return {
      items: result.items.map((i) => ({
        id: i.id,
        walletId: i.walletId,
        transactionId: i.transactionId,
        direction: i.direction,
        money: i.money.toJSON(),
        balanceBefore: i.balanceBefore.toJSON(),
        balanceAfter: i.balanceAfter.toJSON(),
        createdAt: i.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
