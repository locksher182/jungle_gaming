import type { WalletLedgerEntry } from "../models/wallet-ledger-entry";

export interface LedgerCursorPagination {
  cursor?: string;
  limit: number;
}

export interface PaginatedLedgerResult {
  items: WalletLedgerEntry[];
  nextCursor?: string;
}

export interface IWalletLedgerRepository {
  save(entry: WalletLedgerEntry): Promise<void>;
  findByWalletId(walletId: string): Promise<WalletLedgerEntry[]>;
  findByWalletIdPaginated(
    walletId: string,
    options: LedgerCursorPagination
  ): Promise<PaginatedLedgerResult>;
}
