import { DomainError } from "../../domain/errors/domain-error";
import type { WagerTransaction } from "../../domain/models/wager-transaction";
import type { ITransactionRunner } from "../ports/unit-of-work.interface";

export class GetTransactionUseCase {
  constructor(private readonly transactionRunner: ITransactionRunner) {}

  public async getById(transactionId: string): Promise<WagerTransaction> {
    return await this.transactionRunner.run(async (uow) => {
      const tx = await uow.wagerTransactions.findById(transactionId);
      if (!tx) {
        throw new DomainError(`Transaction "${transactionId}" not found`, "TRANSACTION_NOT_FOUND");
      }
      return tx;
    });
  }

  public async getByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string
  ): Promise<WagerTransaction> {
    return await this.transactionRunner.run(async (uow) => {
      const tx = await uow.wagerTransactions.findByProviderAndExternalId(
        providerId,
        externalTransactionId
      );
      if (!tx) {
        throw new DomainError(
          `Transaction "${externalTransactionId}" for provider "${providerId}" not found`,
          "TRANSACTION_NOT_FOUND"
        );
      }
      return tx;
    });
  }
}
