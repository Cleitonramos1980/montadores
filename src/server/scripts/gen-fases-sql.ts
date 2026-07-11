import oracledb from "oracledb";
import { writeFileSync } from "node:fs";

oracledb.fetchAsString = [oracledb.CLOB];

const KEYS = [
  "EM_SEPARACAO_CONFERENCIA",
  "SEPARACAO_INICIADA",
  "CONFERENCIA_FINALIZADA",
  "CONFERIDO_AGUARDANDO_FATURAMENTO",
  "FATURADO_AGUARDANDO_SAIDA",
];

const q = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER!,
  password: process.env.ORACLE_PASSWORD!,
  connectString: process.env.ORACLE_CONNECT_STRING!,
});

const out: string[] = [];
out.push("-- =====================================================================");
out.push("-- App Montadores — Templates e configuração das fases de mensagem");
out.push("-- Gerado a partir do estado real do banco. Idempotente (MERGE).");
out.push("-- Tabelas: MONT_MSG_TEMPLATES, MONT_FLUXO_EVENT_CONFIG");
out.push("-- =====================================================================");
out.push("");

try {
  for (const key of KEYS) {
    const tpl = (await conn.execute(
      `SELECT EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE,
              SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H
       FROM MONT_MSG_TEMPLATES WHERE UPPER(EVENT_TYPE) = :k`,
      { k: key }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows[0];

    const cfg = (await conn.execute(
      `SELECT EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, OBSERVACAO
       FROM MONT_FLUXO_EVENT_CONFIG WHERE EVENT_KEY = :k`,
      { k: key }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows[0];

    out.push("-- ---------------------------------------------------------------------");
    out.push(`-- ${key}`);
    out.push("-- ---------------------------------------------------------------------");

    if (tpl) {
      out.push(`MERGE INTO MONT_MSG_TEMPLATES t USING DUAL ON (UPPER(t.EVENT_TYPE) = '${key}')`);
      out.push(`WHEN MATCHED THEN UPDATE SET`);
      out.push(`  SUBJECT = ${q(tpl.SUBJECT)},`);
      out.push(`  BODY = ${q(tpl.BODY)},`);
      out.push(`  ACTIVE = ${q(tpl.ACTIVE)},`);
      out.push(`  SEND_HOUR_START = ${q(tpl.SEND_HOUR_START)}, SEND_HOUR_END = ${q(tpl.SEND_HOUR_END)},`);
      out.push(`  RESEND_ALLOWED = ${q(tpl.RESEND_ALLOWED)}, MAX_RESENDS = ${q(tpl.MAX_RESENDS)}, RESEND_AFTER_H = ${q(tpl.RESEND_AFTER_H)}`);
      out.push(`WHEN NOT MATCHED THEN INSERT`);
      out.push(`  (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H)`);
      out.push(`  VALUES (SYS_GUID(), ${q(tpl.EVENT_TYPE)}, ${q(tpl.CHANNEL ?? "WHATSAPP")}, ${q(tpl.RECIPIENT ?? "CLIENTE")}, ${q(tpl.SUBJECT)}, ${q(tpl.BODY)}, ${q(tpl.ACTIVE)}, ${q(tpl.SEND_HOUR_START)}, ${q(tpl.SEND_HOUR_END)}, ${q(tpl.RESEND_ALLOWED)}, ${q(tpl.MAX_RESENDS)}, ${q(tpl.RESEND_AFTER_H)});`);
    } else {
      out.push(`-- (sem template em MONT_MSG_TEMPLATES)`);
    }
    out.push("");

    if (cfg) {
      out.push(`MERGE INTO MONT_FLUXO_EVENT_CONFIG c USING DUAL ON (c.EVENT_KEY = '${key}')`);
      out.push(`WHEN MATCHED THEN UPDATE SET`);
      out.push(`  ATIVO_MENSAGEM = ${q(cfg.ATIVO_MENSAGEM)}, MODO_ENVIO = ${q(cfg.MODO_ENVIO)}, TELEFONES_TESTE = ${q(cfg.TELEFONES_TESTE)}, ATUALIZADO_EM = SYSTIMESTAMP`);
      out.push(`WHEN NOT MATCHED THEN INSERT`);
      out.push(`  (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE, ATUALIZADO_EM)`);
      out.push(`  VALUES (${q(cfg.EVENT_KEY)}, ${q(cfg.LABEL)}, ${q(cfg.ATIVO_DASHBOARD)}, ${q(cfg.ATIVO_MENSAGEM)}, ${q(cfg.MODO_ENVIO)}, ${q(cfg.TELEFONES_TESTE)}, SYSTIMESTAMP);`);
    } else {
      out.push(`-- (sem config em MONT_FLUXO_EVENT_CONFIG)`);
    }
    out.push("");
  }
  out.push("COMMIT;");
  out.push("");

  const path = "c:/Users/cleit/OneDrive/Documentos/app montadores/src/server/db/sql/fases-mensagens.sql";
  const { mkdirSync } = await import("node:fs");
  mkdirSync("c:/Users/cleit/OneDrive/Documentos/app montadores/src/server/db/sql", { recursive: true });
  writeFileSync(path, out.join("\n"), "utf8");
  console.log("Gerado:", path);
  console.log("=".repeat(70));
  console.log(out.join("\n"));
} finally {
  await conn.close();
}
