import { DomainError } from "../../domain/errors/domain-error";
import type { Wallet } from "../../domain/models/wallet";
import type { ITransactionRunner } from "../ports/unit-of-work.interface";

export class GetWalletUseCase {
  constructor(private readonly transactionRunner: ITransactionRunner) {}

  public async execute(walletId: string): Promise<Wallet> {
    return await this.transactionRunner.run(async (uow) => {
      const wallet = await uow.wallets.findById(walletId);
      if (!wallet) {
        throw new DomainError(`Wallet "${walletId}" not found`, "WALLET_NOT_FOUND");
      }
      return wallet;
    });
  }
}
