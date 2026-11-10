import {
  Controller,
  Post,
  Headers,
  Body,
  Res,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionDto,
} from "../../../application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionStatus } from "../../../domain/models/wager-transaction";

@Controller("wagering")
export class WageringController {
  constructor(
    private readonly processWagerTxUseCase: ProcessWagerTransactionUseCase
  ) {}

  @Post("transactions")
  public async handleTransaction(
    @Headers("Idempotency-Key") idempotencyKeyHeader: string | undefined,
    @Body() body: Omit<ProcessWagerTransactionDto, "idempotencyKey">,
    @Res() res: Response
  ) {
    const dto: ProcessWagerTransactionDto = {
      ...body,
      idempotencyKey: idempotencyKeyHeader || undefined,
    };

    const result = await this.processWagerTxUseCase.execute(dto);

    if (result.status === WagerTransactionStatus.PendingReference) {
      return res.status(HttpStatus.ACCEPTED).json({
        transactionId: result.transaction.id,
        status: result.status,
        isReplay: result.isReplay,
      });
    }

    return res.status(HttpStatus.OK).json({
      transactionId: result.transaction.id,
      status: result.status,
      rejectionReason: result.rejectionReason,
      isReplay: result.isReplay,
    });
  }
}

