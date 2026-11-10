import {
  Controller,
  Post,
  Get,
  Param,
  Headers,
  Body,
  Res,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionDto,
} from "../../../application/use-cases/process-wager-transaction.use-case";
import { GetTransactionUseCase } from "../../../application/use-cases/get-transaction.use-case";
import { WagerTransactionStatus } from "../../../domain/models/wager-transaction";
import { NoOpAuthGuard } from "../guards/noop-auth.guard";

@Controller("wagering")
@UseGuards(NoOpAuthGuard)
export class WageringController {
  constructor(
    private readonly processWagerTxUseCase: ProcessWagerTransactionUseCase,
    private readonly getTransactionUseCase: GetTransactionUseCase
  ) {}

  @Post("transactions")
  public async handleTransaction(
    @Headers("Idempotency-Key") idempotencyKeyHeader: string | undefined,
    @Body() body: Omit<ProcessWagerTransactionDto, "idempotencyKey">,
    @Res() res: Response
  ) {
    if (!idempotencyKeyHeader || idempotencyKeyHeader.trim() === "") {
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: "MISSING_IDEMPOTENCY_KEY",
        message: "Header 'Idempotency-Key' is required and cannot be empty",
      });
    }

    const dto: ProcessWagerTransactionDto = {
      ...body,
      idempotencyKey: idempotencyKeyHeader.trim(),
    };

    const result = await this.processWagerTxUseCase.execute(dto);

    if (result.status === WagerTransactionStatus.PendingReference) {
      return res.status(HttpStatus.ACCEPTED).json({
        transactionId: result.transaction.id,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
        isReplay: result.isReplay,
      });
    }

    if (result.status === WagerTransactionStatus.Rejected) {
      return res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        transactionId: result.transaction.id,
        status: result.status,
        rejectionReason: result.rejectionReason,
        balance: result.balance,
        idempotentReplay: result.idempotentReplay,
        isReplay: result.isReplay,
      });
    }

    return res.status(HttpStatus.OK).json({
      transactionId: result.transaction.id,
      status: result.status,
      balance: result.balance,
      idempotentReplay: result.idempotentReplay,
      isReplay: result.isReplay,
    });
  }

  @Get("transactions/:transactionId")
  public async getTransaction(@Param("transactionId") transactionId: string, @Res() res: Response) {
    const tx = await this.getTransactionUseCase.getById(transactionId);
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
