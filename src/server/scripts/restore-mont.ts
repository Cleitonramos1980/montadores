/**
 * Restauração lógica das tabelas MONT_* a partir de um backup gerado por backup-mont.ts.
 * Uso: npm run restore -- <caminho-do-diretorio-de-backup>
 *
 * Estratégia: upsert (MERGE por chave) linha a linha, em múltiplas passagens para
 * resolver ordem de FK automaticamente (linhas que falham por FK são retentadas após
 * as demais tabelas carregarem). O schema deve já existir (initTables cria no boot).
 *
 * SEGURANÇA: escreve no banco. Rode apontando para um banco/ambiente de restauração —
 * nunca contra produção sem autorização. Confirma com a variável RESTORE_CONFIRM=SIM.
 */
import oracledb from "oracledb";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

oracledb.fetchAsString = [oracledb.CLOB];

async function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error("Uso: npm run restore -- <diretorio-de-backup>");
    process.exit(1);
  }
  if (process.env.RESTORE_CONFIRM !== "SIM") {
    console.error("Recusado: defina RESTORE_CONFIRM=SIM para confirmar a escrita no banco.");
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "_manifest.json");
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
  });

  // Colunas PK por tabela (para montar o ON do MERGE).
  async function pkCols(table: string): Promise<string[]> {
    const r = (await conn.execute(
      `SELECT cc.COLUMN_NAME FROM USER_CONSTRAINTS c
       JOIN USER_CONS_COLUMNS cc ON cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
       WHERE c.TABLE_NAME = :t AND c.CONSTRAINT_TYPE = 'P' ORDER BY cc.POSITION`,
      { t: table }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows as any[];
    return r.map((x) => x.COLUMN_NAME as string);
  }

  type Pending = { table: string; row: Record<string, unknown>; pk: string[] };
  let pending: Pending[] = [];

  try {
    for (const file of files) {
      const table = file.replace(/\.json$/, "");
      const rows = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>[];
      const pk = await pkCols(table);
      for (const row of rows) pending.push({ table, row, pk });
    }
    console.log(`Carregadas ${pending.length} linhas de ${files.length} tabelas.`);

    let pass = 0;
    let inserted = 0;
    while (pending.length > 0 && pass < 6) {
      pass++;
      const stillPending: Pending[] = [];
      for (const p of pending) {
        const cols = Object.keys(p.row);
        if (cols.length === 0) continue;
        const binds: Record<string, unknown> = {};
        for (const c of cols) binds[c] = p.row[c] ?? null;
        const onCols = (p.pk.length ? p.pk : [cols[0]]);
        const on = onCols.map((c) => `tgt.${c} = :${c}`).join(" AND ");
        const updSet = cols.filter((c) => !onCols.includes(c)).map((c) => `tgt.${c} = :${c}`).join(", ");
        const insCols = cols.join(", ");
        const insVals = cols.map((c) => `:${c}`).join(", ");
        const sql =
          `MERGE INTO ${p.table} tgt USING DUAL ON (${on}) ` +
          (updSet ? `WHEN MATCHED THEN UPDATE SET ${updSet} ` : "") +
          `WHEN NOT MATCHED THEN INSERT (${insCols}) VALUES (${insVals})`;
        try {
          await conn.execute(sql, binds, { autoCommit: false });
          inserted++;
        } catch (e: any) {
          // ORA-02291 = FK pai ausente → retenta na próxima passagem
          if (e?.errorNum === 2291) stillPending.push(p);
          else { console.warn(`  [${p.table}] linha ignorada: ${e?.message?.slice(0, 100)}`); }
        }
      }
      await conn.commit();
      console.log(`  passagem ${pass}: ${inserted} aplicadas, ${stillPending.length} pendentes (FK)`);
      if (stillPending.length === pending.length) break; // sem progresso
      pending = stillPending;
    }
    if (pending.length > 0) console.warn(`ATENÇÃO: ${pending.length} linhas não restauradas (FK não resolvida).`);
    console.log("Restauração concluída.");
  } finally {
    await conn.close();
  }
}

main().catch((e) => { console.error("ERRO no restore:", (e as Error).message); process.exit(1); });
