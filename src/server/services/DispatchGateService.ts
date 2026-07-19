export type GateResult = {
  allowed: boolean;
  reason?: string;
};

// Feriados nacionais brasileiros calculados por ano (não expira).
// Fixos + móveis derivados da Páscoa (Sexta-feira Santa, Corpus Christi).
const pad = (n: number) => String(n).padStart(2, "0");

// Domingo de Páscoa (algoritmo de Meeus/Butcher) para um dado ano.
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function offsetDate(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const feriadosCache = new Map<number, Set<string>>();
function feriadosDoAno(year: number): Set<string> {
  let set = feriadosCache.get(year);
  if (set) return set;
  const easter = easterSunday(year);
  set = new Set<string>([
    `${year}-01-01`, // Confraternização
    `${year}-04-21`, // Tiradentes
    `${year}-05-01`, // Dia do Trabalho
    `${year}-09-07`, // Independência
    `${year}-10-12`, // Nossa Senhora Aparecida
    `${year}-11-02`, // Finados
    `${year}-11-15`, // Proclamação da República
    `${year}-11-20`, // Consciência Negra (nacional desde 2024)
    `${year}-12-25`, // Natal
    offsetDate(easter, -2), // Sexta-feira Santa
    offsetDate(easter, 60), // Corpus Christi
  ]);
  feriadosCache.set(year, set);
  return set;
}

export class DispatchGateService {
  check(params: {
    sendHourStart?: number;
    sendHourEnd?: number;
    nowOverride?: Date;
  } = {}): GateResult {
    const { sendHourStart = 8, sendHourEnd = 21, nowOverride } = params;
    const now = nowOverride ?? new Date();

    // Deriva data/hora/dia-da-semana no FUSO DE OPERAÇÃO via Intl.DateTimeFormat (mesma
    // abordagem do MessageSchedulerService). Antes o código misturava acessores locais
    // (getDay/getHours) com UTC (toISOString) sobre um mesmo Date deslocado, produzindo
    // janela/feriado errados em servidor fora de UTC (duplo offset).
    const tz = process.env.SCHEDULER_TIMEZONE || "America/Sao_Paulo";
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now); // YYYY-MM-DD no fuso de operação
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now),
    );
    // Dia da semana da data civil (0=Dom … 6=Sáb) — UTC-safe a partir de dateStr.
    const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    const year = Number(dateStr.slice(0, 4));

    if (dow === 0 || dow === 6) {
      return { allowed: false, reason: "Fim de semana" };
    }
    if (feriadosDoAno(year).has(dateStr)) {
      return { allowed: false, reason: `Feriado nacional: ${dateStr}` };
    }
    if (hour < sendHourStart || hour >= sendHourEnd) {
      return { allowed: false, reason: `Fora do horário permitido (${sendHourStart}h–${sendHourEnd}h ${tz})` };
    }
    return { allowed: true };
  }
}
