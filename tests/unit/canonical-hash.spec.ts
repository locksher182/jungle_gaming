import { describe, it, expect } from "bun:test";
import { computeCanonicalPayloadHash } from "../../src/domain/utils/canonical-json";

describe("Canonical JSON Hash for Idempotency (Unit Tests)", () => {
  it("deve produzir o mesmo hash independentemente da ordem das chaves no objeto", () => {
    const payloadA = {
      providerId: "provider-x",
      playerId: "player-123",
      kind: "BET",
      money: { amount: "50.00", currency: "BRL" },
    };

    const payloadB = {
      money: { currency: "BRL", amount: "50.00" },
      kind: "BET",
      playerId: "player-123",
      providerId: "provider-x",
    };

    const hashA = computeCanonicalPayloadHash(payloadA);
    const hashB = computeCanonicalPayloadHash(payloadB);

    expect(hashA).toBe(hashB);
  });

  it("deve produzir hash diferente para valores de negócio divergentes", () => {
    const payloadA = {
      providerId: "provider-x",
      money: { amount: "50.00", currency: "BRL" },
    };

    const payloadB = {
      providerId: "provider-x",
      money: { amount: "50.01", currency: "BRL" },
    };

    expect(computeCanonicalPayloadHash(payloadA)).not.toBe(computeCanonicalPayloadHash(payloadB));
  });
});
