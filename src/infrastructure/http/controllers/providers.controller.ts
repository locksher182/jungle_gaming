import { Controller, Get, Param, HttpStatus, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { GetTransactionUseCase } from "../../../application/use-cases/get-transaction.use-case";
import { NoOpAuthGuard } from "../guards/noop-auth.guard";

@Controller("providers")
@UseGuards(NoOpAuthGuard)
export class ProvidersController {
  constructor(private readonly getTransactionUseCase: GetTransactionUseCase) {}

  @Get(":providerId/wagering/transactions/:externalTransactionId")
  public async getProviderTransaction(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
    @Res() res: Response
  ) {
    const tx = await this.getTransactionUseCase.getByProviderAndExternalId(
      providerId,
      externalTransactionId
    );

    return res.status(HttpStatus.OK).json({
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      balance: tx.observedBalance?.toJSON(),
      rejectionReason: tx.rejectionReason,
      processedAt: tx.processedAt?.toISOString(),
      createdAt: tx.createdAt.toISOString(),
      updatedAt: tx.updatedAt.toISOString(),
    });
  }
}
