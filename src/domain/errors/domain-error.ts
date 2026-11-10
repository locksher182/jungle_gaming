export class DomainError extends Error {
  public readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}
