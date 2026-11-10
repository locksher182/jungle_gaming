import { LedgerDirection } from "../models/wallet-ledger-entry";
import type { MoneyProps } from "../models/money";

export interface IntegrationEventProps<T> {
  eventId?: string;
  aggregateId: string;
  correlationId?: string;
  causationId?: string;
  occurredAt?: Date;
  data: T;
}

export abstract class IntegrationEvent<T> {
  public readonly eventId: string;
  public readonly aggregateId: string;
  public readonly correlationId: string | undefined;
  public readonly causationId: string | undefined;
  public readonly occurredAt: Date;
  public readonly data: T;
  public abstract readonly eventType: string;
  public abstract readonly version: number;

  constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId ?? crypto.randomUUID();
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt ?? new Date();
    this.data = props.data;
  }

  public toJSON(): {
    eventId: string;
    eventType: string;
    version: number;
    aggregateId: string;
    correlationId: string | undefined;
    causationId: string | undefined;
    occurredAt: string;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      data: this.data,
    };
  }
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export interface EventContext {
  correlationId?: string;
  causationId?: string;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public readonly eventType = "WalletBalanceChanged";
  public readonly version = 1;

  public static from(
    wallet: { id: string; version: number },
    entry: {
      transactionId: string;
      direction: LedgerDirection;
      money: { toJSON: () => MoneyProps };
      balanceBefore: { toJSON: () => MoneyProps };
      balanceAfter: { toJSON: () => MoneyProps };
      createdAt: Date;
    },
    ctx?: EventContext
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: crypto.randomUUID(),
      aggregateId: wallet.id,
      correlationId: ctx?.correlationId ?? entry.transactionId,
      causationId: ctx?.causationId,
      occurredAt: entry.createdAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  public readonly eventType = "WagerTransactionProcessed";
  public readonly version = 1;
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  reason: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  public readonly eventType = "WagerTransactionRejected";
  public readonly version = 1;
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  public readonly eventType = "WagerTransactionPendingReference";
  public readonly version = 1;
}
