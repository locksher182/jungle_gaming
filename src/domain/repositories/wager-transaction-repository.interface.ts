import type { WagerTransaction } from "../models/wager-transaction";

export interface IWagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string
  ): Promise<WagerTransaction | null>;
  findReversalsForReference(
    providerId: string,
    referenceExternalId: string
  ): Promise<WagerTransaction[]>;
  findPendingReferences(limit?: number): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction): Promise<void>;
}
