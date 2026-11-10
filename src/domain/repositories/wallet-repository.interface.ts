import type { Wallet } from "../models/wallet";

export interface IWalletRepository {
  findById(id: string): Promise<Wallet | null>;
  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
  findByIdForUpdate(id: string): Promise<Wallet | null>;
}
