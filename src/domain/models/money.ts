import Decimal from "decimal.js";
import { DomainError } from "../errors/domain-error";

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string
  ) {}

  public static from(props: MoneyProps): Money {
    if (!props || typeof props.amount !== "string" || typeof props.currency !== "string") {
      throw new DomainError("Invalid MoneyProps: amount and currency must be strings");
    }

    const trimmedCurrency = props.currency.trim().toUpperCase();
    if (trimmedCurrency.length === 0) {
      throw new DomainError("Currency cannot be empty");
    }

    const trimmedAmount = props.amount.trim();
    if (trimmedAmount.length === 0) {
      throw new DomainError("Amount cannot be empty");
    }

    if (/[eE]/.test(trimmedAmount)) {
      throw new DomainError("Scientific notation is not allowed");
    }

    // Input contract rejects negative values
    if (trimmedAmount.startsWith("-")) {
      throw new DomainError("Negative amounts are not allowed in input contract");
    }

    // Decimal string with at most 2 decimal places
    const validDecimalRegex = /^\d+(\.\d{1,2})?$/;
    if (!validDecimalRegex.test(trimmedAmount)) {
      throw new DomainError(
        `Invalid amount format: "${props.amount}". Must be non-negative with at most 2 decimal places.`
      );
    }

    try {
      const dec = new Decimal(trimmedAmount);
      if (dec.isNaN() || !dec.isFinite()) {
        throw new DomainError("Amount must be a finite number");
      }
      return new Money(dec, trimmedCurrency);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError(`Failed to parse Decimal amount: ${props.amount}`);
    }
  }

  public static zero(currency: string): Money {
    const trimmedCurrency = currency.trim().toUpperCase();
    if (trimmedCurrency.length === 0) {
      throw new DomainError("Currency cannot be empty");
    }
    return new Money(new Decimal(0), trimmedCurrency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  public isNegative(): boolean {
    return this.value.lessThan(0);
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  public toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (!other || this.currency !== other.currency) {
      throw new DomainError(
        `Currency mismatch: cannot operate between ${this.currency} and ${other?.currency}`
      );
    }
  }
}
