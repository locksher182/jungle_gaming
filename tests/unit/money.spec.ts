import { describe, it, expect } from "bun:test";
import { Money } from "../../src/domain/models/money";
import { DomainError } from "../../src/domain/errors/domain-error";

describe("Money Value Object (Unit Tests)", () => {
  describe("Criação e Validação de Entradas Inválidas", () => {
    it("deve criar uma instância válida com duas casas decimais e moeda ISO", () => {
      const money = Money.from({ amount: "25.00", currency: "BRL" });
      expect(money.toString()).toBe("25.00 BRL");
      expect(money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
      expect(money.currency).toBe("BRL");
    });

    it("deve criar instância zero para uma moeda", () => {
      const zero = Money.zero("BRL");
      expect(zero.toString()).toBe("0.00 BRL");
      expect(zero.isZero()).toBe(true);
    });

    it("deve rejeitar valor com mais de duas casas decimais", () => {
      expect(() => Money.from({ amount: "25.001", currency: "BRL" })).toThrow(DomainError);
    });

    it("deve rejeitar valores negativos em contratos de entrada", () => {
      expect(() => Money.from({ amount: "-10.00", currency: "BRL" })).toThrow(DomainError);
    });

    it("deve rejeitar NaN, Infinity ou strings inválidas", () => {
      expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(DomainError);
      expect(() => Money.from({ amount: "Infinity", currency: "BRL" })).toThrow(DomainError);
      expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(DomainError);
      expect(() => Money.from({ amount: "abc", currency: "BRL" })).toThrow(DomainError);
    });

    it("deve rejeitar notação científica", () => {
      expect(() => Money.from({ amount: "1e2", currency: "BRL" })).toThrow(DomainError);
      expect(() => Money.from({ amount: "1.5e-1", currency: "BRL" })).toThrow(DomainError);
    });
  });

  describe("Operações Aritméticas e Imutabilidade", () => {
    it("deve somar dois valores monetários da mesma moeda sem mutar as instâncias originais", () => {
      const a = Money.from({ amount: "50.00", currency: "BRL" });
      const b = Money.from({ amount: "25.50", currency: "BRL" });
      const resultado = a.add(b);

      expect(resultado.toJSON()).toEqual({ amount: "75.50", currency: "BRL" });
      expect(a.toJSON()).toEqual({ amount: "50.00", currency: "BRL" });
      expect(b.toJSON()).toEqual({ amount: "25.50", currency: "BRL" });
    });

    it("deve subtrair valores monetários corretamente", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "35.25", currency: "BRL" });
      const resultado = a.subtract(b);

      expect(resultado.toJSON()).toEqual({ amount: "64.75", currency: "BRL" });
    });

    it("deve negar um valor monetário", () => {
      const a = Money.from({ amount: "50.00", currency: "BRL" });
      const neg = a.negate();
      expect(neg.isNegative()).toBe(true);
      expect(neg.toJSON().amount).toBe("-50.00");
    });

    it("deve lançar erro de domínio ao operar moedas diferentes", () => {
      const brl = Money.from({ amount: "50.00", currency: "BRL" });
      const usd = Money.from({ amount: "50.00", currency: "USD" });

      expect(() => brl.add(usd)).toThrow(DomainError);
      expect(() => brl.subtract(usd)).toThrow(DomainError);
      expect(() => brl.isLessThan(usd)).toThrow(DomainError);
      expect(() => brl.equals(usd)).toThrow(DomainError);
    });
  });

  describe("Comparações e Predicados", () => {
    it("deve comparar igualdade, maior e menor", () => {
      const m10 = Money.from({ amount: "10.00", currency: "BRL" });
      const m20 = Money.from({ amount: "20.00", currency: "BRL" });
      const m10Clone = Money.from({ amount: "10.00", currency: "BRL" });

      expect(m10.equals(m10Clone)).toBe(true);
      expect(m10.equals(m20)).toBe(false);
      expect(m10.isLessThan(m20)).toBe(true);
      expect(m20.isLessThan(m10)).toBe(false);
      expect(m10.isPositive()).toBe(true);
      expect(Money.zero("BRL").isZero()).toBe(true);
    });
  });
});
