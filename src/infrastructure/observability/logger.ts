export interface StructuredLogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEY_REGEX = /(pass(word)?|secret|token|auth(orization)?|cred(ential)?|key|api_?key|pin|cvv|cpf|ssn|card)/i;
const CONNECTION_STRING_PASSWORD_REGEX = /(:\/\/[^:]+:)([^@]+)(@)/g;

export class StructuredLogger {
  public static sanitize(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      // Mask credentials in connection strings/URLs
      return value.replace(CONNECTION_STRING_PASSWORD_REGEX, "$1***$3");
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (typeof value === "object") {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEY_REGEX.test(k)) {
          sanitized[k] = "***MASKED***";
        } else {
          sanitized[k] = this.sanitize(v);
        }
      }
      return sanitized;
    }

    return value;
  }

  public static info(message: string, context: StructuredLogContext = {}): void {
    console.log(
      JSON.stringify({
        level: "INFO",
        timestamp: new Date().toISOString(),
        message: typeof message === "string" ? message.replace(CONNECTION_STRING_PASSWORD_REGEX, "$1***$3") : message,
        ...(this.sanitize(context) as Record<string, unknown>),
      })
    );
  }

  public static warn(message: string, context: StructuredLogContext = {}): void {
    console.warn(
      JSON.stringify({
        level: "WARN",
        timestamp: new Date().toISOString(),
        message: typeof message === "string" ? message.replace(CONNECTION_STRING_PASSWORD_REGEX, "$1***$3") : message,
        ...(this.sanitize(context) as Record<string, unknown>),
      })
    );
  }

  public static error(message: string, error?: unknown, context: StructuredLogContext = {}): void {
    console.error(
      JSON.stringify({
        level: "ERROR",
        timestamp: new Date().toISOString(),
        message: typeof message === "string" ? message.replace(CONNECTION_STRING_PASSWORD_REGEX, "$1***$3") : message,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : this.sanitize(error),
        ...(this.sanitize(context) as Record<string, unknown>),
      })
    );
  }
}
