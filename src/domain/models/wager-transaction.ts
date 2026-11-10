import { DomainError } from "../errors/domain-error";
import { Money } from "./money";
import { LedgerDirection } from "./wallet-ledger-entry";

export enum WagerTransactionKind {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status: WagerTransactionStatus;
  rejectionReason?: string;
  observedBalance?: Money;
  pendingAttempts?: number;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    private _referenceTransactionId: string | undefined,
    private _status: WagerTransactionStatus,
    private _rejectionReason: string | undefined,
    private _observedBalance: Money | undefined,
    private _pendingAttempts: number,
    private _processedAt: Date | undefined,
    public readonly createdAt: Date,
    private _updatedAt: Date
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback
    ) {
      if (
        !props.referenceExternalTransactionId ||
        props.referenceExternalTransactionId.trim() === ""
      ) {
        throw new DomainError(
          "REFUND and ROLLBACK transactions require referenceExternalTransactionId"
        );
      }
    }

    const now = props.createdAt ?? new Date();
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.referenceTransactionId,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      0,
      undefined,
      now,
      now
    );
  }

  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.referenceTransactionId,
      state.status,
      state.rejectionReason,
      state.observedBalance,
      state.pendingAttempts ?? 0,
      state.processedAt,
      state.createdAt,
      state.updatedAt
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get rejectionReason(): string | undefined {
    return this._rejectionReason;
  }

  public get failureCode(): string | undefined {
    return this._rejectionReason;
  }

  public get observedBalance(): Money | undefined {
    return this._observedBalance;
  }

  public get pendingAttempts(): number {
    return this._pendingAttempts;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  public markProcessed(referenceTransactionId?: string, at?: Date): void {
    if (this.isTerminal()) {
      throw new DomainError("Transaction is already in terminal state");
    }
    if (referenceTransactionId) {
      this._referenceTransactionId = referenceTransactionId;
    }
    this._status = WagerTransactionStatus.Processed;
    this._processedAt = at ?? new Date();
    this._updatedAt = this._processedAt;
  }

  public recordObservedBalance(balance: Money): void {
    this._observedBalance = balance;
  }

  public incrementPendingAttempts(): number {
    this._pendingAttempts++;
    this._updatedAt = new Date();
    return this._pendingAttempts;
  }

  public markPendingReference(): void {
    if (this.isTerminal()) {
      throw new DomainError("Transaction is already in terminal state");
    }
    this._status = WagerTransactionStatus.PendingReference;
    this._updatedAt = new Date();
  }

  public reject(reason: string, at?: Date): void {
    if (this.isTerminal()) {
      throw new DomainError("Transaction is already in terminal state");
    }
    this._status = WagerTransactionStatus.Rejected;
    this._rejectionReason = reason;
    this._updatedAt = at ?? new Date();
  }

  public fail(reason: string, at?: Date): void {
    if (this.isTerminal()) {
      throw new DomainError("Transaction is already in terminal state");
    }
    this._status = WagerTransactionStatus.Failed;
    this._rejectionReason = reason;
    this._updatedAt = at ?? new Date();
  }

  public matchesPayload(hash: string): boolean {
    return this.payloadHash === hash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback:
        if (!reference) return undefined;
        if (reference.kind === WagerTransactionKind.Bet) return LedgerDirection.Credit;
        if (
          reference.kind === WagerTransactionKind.Win ||
          reference.kind === WagerTransactionKind.Refund
        ) {
          return LedgerDirection.Debit;
        }
        return undefined;
      case WagerTransactionKind.Loss:
      default:
        return undefined;
    }
  }
}
