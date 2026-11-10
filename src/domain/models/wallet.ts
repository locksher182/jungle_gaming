import { DomainError } from "../errors/domain-error";
import { Money } from "./money";
import { WalletLedgerEntry, LedgerDirection } from "./wallet-ledger-entry";

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date
  ) {}

  public static open(props: OpenWalletProps): Wallet {
    if (!props.id || !props.playerId || !props.initialBalance) {
      throw new DomainError("id, playerId and initialBalance are required to open a wallet");
    }

    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now
    );
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public debit(props: { transactionId: string; amount: Money }): WalletLedgerEntry {
    this.assertSameCurrency(props.amount);

    if (this._balance.isLessThan(props.amount)) {
      throw new DomainError("Insufficient funds for debit", "INSUFFICIENT_FUNDS");
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(props.amount);

    this._balance = balanceAfter;
    this._version++;
    this._updatedAt = new Date();

    return WalletLedgerEntry.create({
      id: crypto.randomUUID(),
      walletId: this.id,
      transactionId: props.transactionId,
      direction: LedgerDirection.Debit,
      money: props.amount,
      balanceBefore,
      balanceAfter,
      createdAt: this._updatedAt,
    });
  }

  public credit(props: { transactionId: string; amount: Money }): WalletLedgerEntry {
    this.assertSameCurrency(props.amount);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(props.amount);

    this._balance = balanceAfter;
    this._version++;
    this._updatedAt = new Date();

    return WalletLedgerEntry.create({
      id: crypto.randomUUID(),
      walletId: this.id,
      transactionId: props.transactionId,
      direction: LedgerDirection.Credit,
      money: props.amount,
      balanceBefore,
      balanceAfter,
      createdAt: this._updatedAt,
    });
  }

  private assertSameCurrency(money: Money): void {
    if (!money || this.currency !== money.currency) {
      throw new DomainError(
        `Currency mismatch: wallet currency is ${this.currency}, but received ${money?.currency}`
      );
    }
  }
}
