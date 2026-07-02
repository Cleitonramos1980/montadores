import { describe, it, expect } from "vitest";
import { DispatchGateService } from "../server/services/DispatchGateService";

const gate = new DispatchGateService();

// Helper: cria uma Date em horário BRT (UTC-3) a partir de valores locais
function brt(year: number, month: number, day: number, hour: number, minute = 0): Date {
  // Retorna um Date cujo instante corresponde a hour:minute em Brasília
  const utcOffset = 3 * 60 * 60 * 1000; // BRT = UTC-3
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0));
}

describe("DispatchGateService", () => {

  // ─── Horário permitido ────────────────────────────────────────────────────
  describe("Janela de horário (BRT)", () => {
    it("08:00 BRT numa terça → permitido", () => {
      // 2026-06-09 (terça-feira)
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 8, 0) }).allowed).toBe(true);
    });

    it("20:59 BRT numa terça → permitido", () => {
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 20, 59) }).allowed).toBe(true);
    });

    it("07:59 BRT numa terça → bloqueado (antes das 8h)", () => {
      const r = gate.check({ nowOverride: brt(2026, 6, 9, 7, 59) });
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain("Fora do horário");
    });

    it("21:00 BRT numa terça → bloqueado (igual ao limite superior, exclusive)", () => {
      const r = gate.check({ nowOverride: brt(2026, 6, 9, 21, 0) });
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain("Fora do horário");
    });

    it("00:00 BRT → bloqueado", () => {
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 0, 0) }).allowed).toBe(false);
    });

    it("23:59 BRT → bloqueado", () => {
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 23, 59) }).allowed).toBe(false);
    });

    it("sendHourStart/End customizados são respeitados", () => {
      // Janela das 9h às 18h
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 8, 30), sendHourStart: 9, sendHourEnd: 18 }).allowed).toBe(false);
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 9, 0),  sendHourStart: 9, sendHourEnd: 18 }).allowed).toBe(true);
      expect(gate.check({ nowOverride: brt(2026, 6, 9, 18, 0), sendHourStart: 9, sendHourEnd: 18 }).allowed).toBe(false);
    });
  });

  // ─── Fim de semana ────────────────────────────────────────────────────────
  describe("Fins de semana", () => {
    it("sábado às 10h → bloqueado", () => {
      // 2026-06-13 é sábado
      const r = gate.check({ nowOverride: brt(2026, 6, 13, 10, 0) });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("Fim de semana");
    });

    it("domingo às 10h → bloqueado", () => {
      // 2026-06-14 é domingo
      const r = gate.check({ nowOverride: brt(2026, 6, 14, 10, 0) });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("Fim de semana");
    });

    it("segunda-feira às 10h → permitido", () => {
      // 2026-06-15 é segunda
      expect(gate.check({ nowOverride: brt(2026, 6, 15, 10, 0) }).allowed).toBe(true);
    });
  });

  // ─── Feriados 2025-2027 ──────────────────────────────────────────────────
  // Quando o feriado cai em fim de semana o gate já bloquearia por "Fim de semana";
  // o importante é que allowed === false independente da razão.
  describe("Feriados nacionais 2025", () => {
    const feriados2025 = [
      ["2025-01-01", "Confraternização"],
      ["2025-04-18", "Sexta-Feira Santa"],
      ["2025-04-21", "Tiradentes"],
      ["2025-05-01", "Dia do Trabalho"],
      ["2025-06-19", "Corpus Christi"],
      ["2025-09-07", "Independência"],        // cai num domingo
      ["2025-10-12", "Nossa Senhora Aparecida"], // domingo
      ["2025-11-02", "Finados"],              // domingo
      ["2025-11-15", "República"],            // sábado
      ["2025-12-25", "Natal"],
    ] as const;

    for (const [date, label] of feriados2025) {
      it(`${date} (${label}) → bloqueado (feriado ou fim de semana)`, () => {
        const [y, m, d] = date.split("-").map(Number);
        expect(gate.check({ nowOverride: brt(y, m, d, 10, 0) }).allowed).toBe(false);
      });
    }

    it("feriados que caem em dia útil têm reason contendo 'Feriado'", () => {
      // 2025-01-01 (quarta), 2025-04-18 (sexta), 2025-04-21 (segunda)
      // 2025-05-01 (quinta), 2025-06-19 (quinta), 2025-12-25 (quinta)
      const uteisFeriados = ["2025-01-01", "2025-04-18", "2025-04-21", "2025-05-01", "2025-06-19", "2025-12-25"];
      for (const date of uteisFeriados) {
        const [y, m, d] = date.split("-").map(Number);
        const r = gate.check({ nowOverride: brt(y, m, d, 10, 0) });
        expect(r.allowed).toBe(false);
        expect(r.reason).toContain("Feriado");
      }
    });
  });

  describe("Feriados nacionais 2026", () => {
    const feriados2026 = [
      "2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01",
      "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02",
      "2026-11-15", "2026-12-25",
    ];

    for (const date of feriados2026) {
      it(`${date} → bloqueado`, () => {
        const [y, m, d] = date.split("-").map(Number);
        expect(gate.check({ nowOverride: brt(y, m, d, 10, 0) }).allowed).toBe(false);
      });
    }
  });

  describe("Feriados nacionais 2027", () => {
    const feriados2027 = [
      "2027-01-01", "2027-03-26", "2027-04-21", "2027-05-01",
      "2027-05-27", "2027-09-07", "2027-10-12", "2027-11-02",
      "2027-11-15", "2027-12-25",
    ];

    for (const date of feriados2027) {
      it(`${date} → bloqueado`, () => {
        const [y, m, d] = date.split("-").map(Number);
        expect(gate.check({ nowOverride: brt(y, m, d, 10, 0) }).allowed).toBe(false);
      });
    }
  });

  // ─── Conversão BRT ────────────────────────────────────────────────────────
  describe("Conversão UTC → BRT", () => {
    it("11:00 UTC = 08:00 BRT → permitido num dia útil", () => {
      // 2026-06-09 (terça), 11:00 UTC = 08:00 BRT
      const utcDate = new Date(Date.UTC(2026, 5, 9, 11, 0, 0));
      expect(gate.check({ nowOverride: utcDate }).allowed).toBe(true);
    });

    it("10:59 UTC = 07:59 BRT → bloqueado", () => {
      const utcDate = new Date(Date.UTC(2026, 5, 9, 10, 59, 0));
      const r = gate.check({ nowOverride: utcDate });
      expect(r.allowed).toBe(false);
    });

    it("meia-noite BRT (03:00 UTC) → bloqueado mesmo que o dia útil seja correto", () => {
      const utcDate = new Date(Date.UTC(2026, 5, 9, 3, 0, 0)); // 00:00 BRT
      expect(gate.check({ nowOverride: utcDate }).allowed).toBe(false);
    });
  });
});
