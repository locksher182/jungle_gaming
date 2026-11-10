import { describe, it, expect } from "bun:test";
import { StructuredLogger } from "../../src/infrastructure/observability/logger";

describe("StructuredLogger Secret Sanitization (Higiene de Contexto)", () => {
  it("deve mascarar senhas, tokens, secrets e chaves de API em objetos de contexto", () => {
    const rawContext = {
      correlationId: "corr-123",
      walletId: "wallet-456",
      password: "my-super-secret-password",
      api_key: "ak_live_99999",
      nested: {
        authorizationToken: "Bearer eyJhbGciOi...",
        cardNumber: "4111111111111111",
        publicFlag: true,
      },
    };

    const sanitized = StructuredLogger.sanitize(rawContext) as any;

    expect(sanitized.correlationId).toBe("corr-123");
    expect(sanitized.walletId).toBe("wallet-456");
    expect(sanitized.password).toBe("***MASKED***");
    expect(sanitized.api_key).toBe("***MASKED***");
    expect(sanitized.nested.authorizationToken).toBe("***MASKED***");
    expect(sanitized.nested.cardNumber).toBe("***MASKED***");
    expect(sanitized.nested.publicFlag).toBe(true);
  });

  it("deve mascarar credenciais embutidas em connection strings", () => {
    const connectionUrl = "postgres://admin_user:super_secret_pw@db.production.internal:5432/finance_db";
    const sanitized = StructuredLogger.sanitize(connectionUrl);

    expect(sanitized).toBe("postgres://admin_user:***@db.production.internal:5432/finance_db");
    expect(sanitized).not.toContain("super_secret_pw");
  });
});
