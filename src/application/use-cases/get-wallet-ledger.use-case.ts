import type { ITransactionRunner } from "../ports/unit-of-work.interface";
import type { PaginatedLedgerResult } from "../../domain/repositories/wallet-ledger-repository.interface";
import { DomainError } from "../../domain/errors/domain-error";

export interface GetWalletLedgerDto {
  walletId: string;
  cursor?: string;
  limit?: number;
}

export class GetWalletLedgerUseCase {
  constructor(private readonly transactionRunner: ITransactionRunner) {}

  public async execute(dto: GetWalletLedgerDto): Promise<PaginatedLedgerResult> {
    return await this.transactionRunner.run(async (uow) => {
      const wallet = await uow.wallets.findById(dto.walletId);
      if (!wallet) {
        throw new DomainError(`Wallet "${dto.walletId}" not found`, "WALLET_NOT_FOUND");
      }

      return await uow.ledger.findByWalletIdPaginated(dto.walletId, {
        cursor: dto.cursor,
        limit: dto.limit ?? 50,
      });
    });
  }
}

