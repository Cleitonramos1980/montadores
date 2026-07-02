export type GateResult = {
  allowed: boolean;
  reason?: string;
};

// Feriados nacionais brasileiros fixos e móveis 2025–2027
const FERIADOS = new Set([
  // 2025
  "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-01",
  "2025-06-19", "2025-09-07", "2025-10-12", "2025-11-02",
  "2025-11-15", "2025-12-25",
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01",
  "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02",
  "2026-11-15", "2026-12-25",
  // 2027
  "2027-01-01", "2027-03-26", "2027-04-21", "2027-05-01",
  "2027-05-27", "2027-09-07", "2027-10-12", "2027-11-02",
  "2027-11-15", "2027-12-25",
]);

export class DispatchGateService {
  check(params: {
    sendHourStart?: number;
    sendHourEnd?: number;
    nowOverride?: Date;
  } = {}): GateResult {
    const { sendHourStart = 8, sendHourEnd = 21, nowOverride } = params;
    const now = nowOverride ?? new Date();

    // Converter para horário de Brasília (UTC-3)
    const brOffset = -3 * 60;
    const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
    const brTime = new Date(utc + brOffset * 60_000);

    const dow     = brTime.getDay();   // 0=Dom, 6=Sáb
    const hour    = brTime.getHours();
    const dateStr = brTime.toISOString().slice(0, 10);

    if (dow === 0 || dow === 6) {
      return { allowed: false, reason: "Fim de semana" };
    }
    if (FERIADOS.has(dateStr)) {
      return { allowed: false, reason: `Feriado nacional: ${dateStr}` };
    }
    if (hour < sendHourStart || hour >= sendHourEnd) {
      return { allowed: false, reason: `Fora do horário permitido (${sendHourStart}h–${sendHourEnd}h BRT)` };
    }
    return { allowed: true };
  }
}
