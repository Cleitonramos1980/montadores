/**
 * Backup lógico das tabelas MONT_* → um JSON por tabela + manifesto.
 * Roda pela aplicação (não exige DBA/expdp). Uso: npm run backup
 *
 * Consistência: todas as tabelas são lidas dentro de uma transação READ ONLY,
 * garantindo um snapshot consistente (mesma SCN) — nenhuma escrita concorrente
 * "vaza" para o meio do backup, evitando estado inconsistente entre tabelas.
 *
 * Agendamento: este script é idempotente e seguro para rodar periodicamente.
 * Ver README ("Backup e recuperação de desastre") para configurar via
 * Agendador de Tarefas do Windows ou cron.
 *
 * ATENÇÃO LGPD: os arquivos contêm dados pessoais (CPF/CNPJ, telefone, endereço).
 * O diretório backups/ está no .gitignore; trate os arquivos como dados sensíveis.
 */
import oracledb from "oracledb";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

oracledb.fetchAsString = [oracledb.CLOB];

/** Falha rápido com mensagem clara se faltar configuração de conexão. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Variável de ambiente ${name} não definida — configure o .env antes de rodar o backup.`,
    );
  }
  return v;
}

async function main() {
  const user = requireEnv("ORACLE_USER");
  const password = requireEnv("ORACLE_PASSWORD");
  const connectString = requireEnv("ORACLE_CONNECT_STRING");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "backups", stamp);
  mkdirSync(outDir, { recursive: true });

  const conn = await oracledb.getConnection({ user, password, connectString });

  try {
    // Snapshot consistente: congela a leitura na SCN de início da transação.
    await conn.execute("SET TRANSACTION READ ONLY");

    const tables = (await conn.execute(
      "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'MONT\\_%' ESCAPE '\\' ORDER BY TABLE_NAME",
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    ) as any).rows.map((r: any) => r.TABLE_NAME as string);

    if (tables.length === 0) {
      console.warn("Nenhuma tabela MONT_* encontrada — verifique o schema/usuário Oracle.");
    }

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
    // Encerra a transação de leitura sem efeitos colaterais.
    await conn.commit().catch(() => {});
    console.log(`\nBackup concluído em ${outDir} (${manifest.length} tabelas).`);
  } finally {
    await conn.close();
  }
}

main().catch((e) => { console.error("ERRO no backup:", (e as Error).message); process.exit(1); });
