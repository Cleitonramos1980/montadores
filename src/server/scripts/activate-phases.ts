import oracledb from "oracledb";
import { randomUUID } from "node:crypto";

oracledb.fetchAsString = [oracledb.CLOB];

const conn = await oracledb.getConnection({
  user: process.env.ORACLE_USER!,
  password: process.env.ORACLE_PASSWORD!,
  connectString: process.env.ORACLE_CONNECT_STRING!,
});

try {
  // Templates faltantes
  for (const [key, subject, body] of [
    [
      "AGUARDANDO_MAPA_ESTOQUE",
      "Pedido {{numped}} recebido — em fila para separacao",
      "Ola, {{nome}}! Seu pedido no {{numped}} foi recebido e esta aguardando emissao do mapa para separacao. Acompanhe o andamento pelo link oficial.",
    ],
    [
      "FINALIZADO",
      "Pedido {{numped}} finalizado no fluxo operacional",
      "Ola, {{nome}}! Seu pedido no {{numped}} foi finalizado com sucesso no fluxo operacional. Se houver entrega ou montagem vinculada, voce recebera novas atualizacoes em breve. Obrigado!",
    ],
  ] as [string, string, string][]) {
    const r = await conn.execute(
      `MERGE INTO MONT_MSG_TEMPLATES tgt
       USING DUAL ON (UPPER(tgt.EVENT_TYPE) = UPPER(:key))
       WHEN NOT MATCHED THEN INSERT
         (ID, EVENT_TYPE, CHANNEL, RECIPIENT, SUBJECT, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END)
       VALUES (:id, :key, 'WHATSAPP', 'CLIENTE', :subject, :body, 1, 8, 21)`,
      { id: randomUUID(), key, subject, body },
      { autoCommit: true },
    ) as any;
    console.log(`Template ${key} — ${r.rowsAffected > 0 ? "CRIADO" : "ja existia"}`);
  }

  // Ativar todas as 6 fases
  const fases = [
    "AGUARDANDO_MAPA_ESTOQUE",
    "MAPA_EMITIDO_AGUARDANDO_SEPARACAO",
    "EM_SEPARACAO_CONFERENCIA",
    "CONFERIDO_AGUARDANDO_FATURAMENTO",
    "FATURADO_AGUARDANDO_SAIDA",
    "FINALIZADO",
  ];
  for (const fase of fases) {
    const r = await conn.execute(
      "UPDATE MONT_FLUXO_EVENT_CONFIG SET ATIVO_MENSAGEM = 1, ATUALIZADO_EM = SYSTIMESTAMP WHERE EVENT_KEY = :key",
      { key: fase },
      { autoCommit: true },
    ) as any;
    console.log(`${fase} — ${r.rowsAffected > 0 ? "ATIVADO" : "NAO ENCONTRADO"}`);
  }

  // Estado final
  const rows = (await conn.execute(
    `SELECT EVENT_KEY, ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE
     FROM MONT_FLUXO_EVENT_CONFIG
     WHERE EVENT_KEY IN ('AGUARDANDO_MAPA_ESTOQUE','MAPA_EMITIDO_AGUARDANDO_SEPARACAO','EM_SEPARACAO_CONFERENCIA','CONFERIDO_AGUARDANDO_FATURAMENTO','FATURADO_AGUARDANDO_SAIDA','FINALIZADO')
     ORDER BY EVENT_KEY`,
    {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  ) as any).rows as any[];

  console.log("\n=== CONFIGURACAO FINAL ===");
  for (const r of rows) {
    const ok = r.ATIVO_MENSAGEM === 1 ? "ATIVO" : "INATIVO";
    console.log(` ${ok} | ${r.EVENT_KEY} | ${r.MODO_ENVIO} | piloto: ${r.TELEFONES_TESTE}`);
  }

  // Templates finais
  const tpls = (await conn.execute(
    `SELECT EVENT_TYPE, ACTIVE FROM MONT_MSG_TEMPLATES
     WHERE EVENT_TYPE IN ('AGUARDANDO_MAPA_ESTOQUE','MAPA_EMITIDO_AGUARDANDO_SEPARACAO','EM_SEPARACAO_CONFERENCIA','CONFERIDO_AGUARDANDO_FATURAMENTO','FATURADO_AGUARDANDO_SAIDA','FINALIZADO')
     ORDER BY EVENT_TYPE`,
    {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  ) as any).rows as any[];

  console.log("\n=== TEMPLATES FINAIS ===");
  for (const r of tpls) {
    console.log(` ${r.EVENT_TYPE} | active: ${r.ACTIVE}`);
  }
} finally {
  await conn.close();
}
