export interface EnqueueOutboxProps {
  id?: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: Date;
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  occurredAt: Date;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: unknown,
    private _attempts: number,
    public readonly occurredAt: Date,
    private _nextAttemptAt: Date | undefined,
    private _publishedAt: Date | undefined,
  ) {}

  public static enqueue(props: EnqueueOutboxProps): OutboxMessage {
    const now = props.occurredAt ?? new Date();
    return new OutboxMessage(
      props.id ?? crypto.randomUUID(),
      props.aggregateId,
      props.eventType,
      props.payload,
      0,
      now,
      undefined,
      undefined,
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.attempts,
      state.occurredAt,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date): boolean {
    if (this._publishedAt !== undefined) return false;
    if (!this._nextAttemptAt) return true;
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date): void {
    this._publishedAt = at;
  }

  public scheduleRetry(now: Date): void {
    this._attempts++;
    // Exponential backoff: base 1000ms * 2^(attempts - 1), capped at 60s
    const delay = Math.min(1000 * Math.pow(2, this._attempts - 1), 60000);
    this._nextAttemptAt = new Date(now.getTime() + delay);
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }
}

