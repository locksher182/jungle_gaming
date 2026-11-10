export interface ReceiveInboxProps {
  id?: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date;
}

export interface InboxMessageState {
  id: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  processedAt?: Date;
  receivedAt: Date;
}

export class InboxMessage {
  private constructor(
    public readonly id: string,
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    private _processedAt: Date | undefined,
    public readonly receivedAt: Date
  ) {}

  public static receive(props: ReceiveInboxProps): InboxMessage {
    const now = props.receivedAt ?? new Date();
    return new InboxMessage(
      props.id ?? crypto.randomUUID(),
      props.messageId,
      props.consumerName,
      props.payloadHash,
      undefined,
      now
    );
  }

  public static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.id,
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.processedAt,
      state.receivedAt
    );
  }

  public isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  public markProcessed(at: Date): void {
    this._processedAt = at;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }
}
