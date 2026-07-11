import oracledb from "oracledb";

oracledb.fetchAsString = [oracledb.CLOB];

const KEYS = [
  "EM_SEPARACAO_CONFERENCIA",
  "SEPARACAO_INICIADA",
  "CONFERENCIA_FINALIZADA",
  "CONFERIDO_AGUARDANDO_FATURAMENTO",
  "FATURADO_AGUARDANDO_SAIDA",
];

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER!,
  password: process.env.ORACLE_PASSWORD!,
  connectString: process.env.ORACLE_CONNECT_STRING!,
});

try {
  for (const key of KEYS) {
    console.log("=".repeat(70));
    console.log("EVENTO:", key);

    const cfg = (await conn.execute(
      `SELECT ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE
       FROM MONT_FLUXO_EVENT_CONFIG WHERE EVENT_KEY = :k`,
      { k: key }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows[0];
    if (cfg) {
      console.log(`  Config: ativo=${cfg.ATIVO_MENSAGEM} | modo=${cfg.MODO_ENVIO} | piloto=${cfg.TELEFONES_TESTE ?? "-"}`);
    } else {
      console.log("  Config: (sem registro em MONT_FLUXO_EVENT_CONFIG)");
    }

    const tpl = (await conn.execute(
      `SELECT SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END, RESEND_ALLOWED
       FROM MONT_MSG_TEMPLATES WHERE UPPER(EVENT_TYPE) = :k`,
      { k: key }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows[0];
    if (tpl) {
      console.log(`  Template: active=${tpl.ACTIVE} | horário=${tpl.SEND_HOUR_START}h-${tpl.SEND_HOUR_END}h | reenvio=${tpl.RESEND_ALLOWED ?? 0}`);
      console.log(`  Assunto: ${tpl.SUBJECT}`);
      console.log(`  Corpo:\n${String(tpl.BODY).split("\n").map((l: string) => "    | " + l).join("\n")}`);
    } else {
      console.log("  Template: (NENHUM em MONT_MSG_TEMPLATES)");
    }
  }
} finally {
  await conn.close();
}
