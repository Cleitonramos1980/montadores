/**
 * Backup lógico das tabelas MONT_* → um JSON por tabela + manifesto.
 * Roda pela aplicação (não exige DBA/expdp). Uso: npm run backup
 *
 * ATENÇÃO LGPD: os arquivos contêm dados pessoais (CPF/CNPJ, telefone, endereço).
 * O diretório backups/ está no .gitignore; trate os arquivos como dados sensíveis.
 */
import oracledb from "oracledb";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

oracledb.fetchAsString = [oracledb.CLOB];

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "backups", stamp);
  mkdirSync(outDir, { recursive: true });

  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
  });

  try {
    const tables = (await conn.execute(
      "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'MONT\\_%' ESCAPE '\\' ORDER BY TABLE_NAME",
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows.map((r: any) => r.TABLE_NAME as string);

    const manifest: Array<{ table: string; rows: number }> = [];
    for (const t of tables) {
      const rows = (await conn.execute(
        `SELECT * FROM ${t}`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ) as any).rows as unknown[];
      writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows, null, 0), "utf8");
      manifest.push({ table: t, rows: rows.length });
      console.log(`  ${t}: ${rows.length} linhas`);
    }
    writeFileSync(
      join(outDir, "_manifest.json"),
      JSON.stringify({ createdAt: stamp, tables: manifest }, null, 2),
      "utf8",
    );
    console.log(`\nBackup concluído em ${outDir} (${manifest.length} tabelas).`);
  } finally {
    await conn.close();
  }
}

main().catch((e) => { console.error("ERRO no backup:", (e as Error).message); process.exit(1); });
