import { DomainError } from "../errors/domain-error";
import { Money } from "./money";

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
  status: WagerTransactionStatus;
  rejectionReason?: string;
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
    private _status: WagerTransactionStatus,
    private _rejectionReason: string | undefined,
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
      WagerTransactionStatus.Pending,
      undefined,
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
      state.status,
      state.rejectionReason,
      state.processedAt,
      state.createdAt,
      state.updatedAt
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get rejectionReason(): string | undefined {
    return this._rejectionReason;
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

  public markProcessed(_details?: unknown, at?: Date): void {
    if (this.isTerminal()) {
      throw new DomainError("Transaction is already in terminal state");
    }
    this._status = WagerTransactionStatus.Processed;
    this._processedAt = at ?? new Date();
    this._updatedAt = this._processedAt;
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
}
