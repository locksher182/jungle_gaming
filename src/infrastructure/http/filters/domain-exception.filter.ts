import { Catch, HttpStatus } from "@nestjs/common";
import type { ExceptionFilter, ArgumentsHost } from "@nestjs/common";
import type { Response } from "express";
import { DomainError } from "../../../domain/errors/domain-error";

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.BAD_REQUEST;

    if (exception.code === "IDEMPOTENCY_CONFLICT") {
      status = HttpStatus.CONFLICT; // 409
    } else if (
      exception.code === "WALLET_NOT_FOUND" ||
      exception.code === "TRANSACTION_NOT_FOUND"
    ) {
      status = HttpStatus.NOT_FOUND; // 404
    } else if (exception.code === "INTERNAL_OPERATION_NOT_ALLOWED") {
      status = HttpStatus.FORBIDDEN; // 403
    } else if (
      exception.code === "INSUFFICIENT_FUNDS" ||
      exception.code === "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE" ||
      exception.code === "CURRENCY_MISMATCH" ||
      exception.code === "PLAYER_MISMATCH"
    ) {
      status = HttpStatus.UNPROCESSABLE_ENTITY; // 422
    }

    response.status(status).json({
      statusCode: status,
      errorCode: exception.code ?? "DOMAIN_ERROR",
      message: exception.message,
    });
  }
}
