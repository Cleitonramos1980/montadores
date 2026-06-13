/**
 * Inspeciona as tabelas WinThor no Oracle.
 * Uso: npx tsx scripts/inspect-winthor.ts
 */

import dotenv from "dotenv";
import oracledb from "oracledb";

dotenv.config();

const TABLES = [
  "PCCLIENT",
  "PCPEDC",
  "PCPEDI",
  "PCPRODUT",
  "PCNFSAID",
  "PCMOV",
  "PCEMPR",
  "PCFORNEC",
  "PCCARREG",
];

async function main() {
  oracledb.fetchAsString = [oracledb.CLOB];

  const pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 1,
    poolMax: 3,
    poolIncrement: 1,
  });

  const conn = await pool.getConnection();

  try {
    // ─── 1. Descobrir em qual schema cada tabela existe ───────────────────────
    console.log("\n════════════════════════════════════════════════════════════");
    console.log("  LOCALIZAÇÃO DAS TABELAS (ALL_TABLES)");
    console.log("════════════════════════════════════════════════════════════");

    const placeholders = TABLES.map((_, i) => `:t${i}`).join(",");
    const binds: Record<string, string> = {};
    TABLES.forEach((t, i) => { binds[`t${i}`] = t; });

    const locationRes = await conn.execute<any>(
      `SELECT OWNER, TABLE_NAME, NUM_ROWS
       FROM ALL_TABLES
       WHERE TABLE_NAME IN (${placeholders})
       ORDER BY TABLE_NAME`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const tableOwners: Record<string, string> = {};
    for (const row of locationRes.rows ?? []) {
      tableOwners[row.TABLE_NAME] = row.OWNER;
      console.log(`  ${row.TABLE_NAME.padEnd(14)} → schema: ${row.OWNER}   (~${row.NUM_ROWS ?? "?"} linhas)`);
    }

    // ─── 2. Colunas de cada tabela ────────────────────────────────────────────
    for (const table of TABLES) {
      const owner = tableOwners[table];
      if (!owner) {
        console.log(`\n⚠  ${table}: não encontrada ou sem acesso`);
        continue;
      }

      console.log(`\n════════════════════════════════════════════════════════════`);
      console.log(`  ${table}  (owner: ${owner})`);
      console.log(`════════════════════════════════════════════════════════════`);

      const colRes = await conn.execute<any>(
        `SELECT atc.COLUMN_NAME, atc.DATA_TYPE, atc.DATA_LENGTH, atc.DATA_PRECISION, atc.DATA_SCALE,
                atc.NULLABLE, atc.DATA_DEFAULT, acc.COMMENTS
         FROM ALL_TAB_COLS atc
         LEFT JOIN ALL_COL_COMMENTS acc
           ON acc.OWNER = atc.OWNER AND acc.TABLE_NAME = atc.TABLE_NAME AND acc.COLUMN_NAME = atc.COLUMN_NAME
         WHERE atc.OWNER = :owner AND atc.TABLE_NAME = :tbl
           AND atc.HIDDEN_COLUMN = 'NO'
         ORDER BY atc.COLUMN_ID`,
        { owner, tbl: table },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      for (const col of colRes.rows ?? []) {
        const typeStr =
          col.DATA_TYPE === "NUMBER" && col.DATA_PRECISION != null
            ? `NUMBER(${col.DATA_PRECISION},${col.DATA_SCALE})`
            : col.DATA_TYPE === "VARCHAR2" || col.DATA_TYPE === "CHAR"
            ? `${col.DATA_TYPE}(${col.DATA_LENGTH})`
            : col.DATA_TYPE;

        const nullable = col.NULLABLE === "N" ? " NOT NULL" : "";
        const defStr = col.DATA_DEFAULT ? ` DEFAULT ${String(col.DATA_DEFAULT).trim()}` : "";
        const comment = col.COMMENTS ? `  ← ${col.COMMENTS}` : "";
        console.log(`  ${col.COLUMN_NAME.padEnd(30)} ${typeStr.padEnd(22)}${nullable}${defStr}${comment}`);
      }

      // ─── 3. Amostra de 3 linhas ──────────────────────────────────────────────
      try {
        const sampleRes = await conn.execute<any>(
          `SELECT * FROM ${owner}.${table} WHERE ROWNUM <= 3`,
          {},
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        if ((sampleRes.rows ?? []).length > 0) {
          console.log(`\n  ── Amostra (3 linhas) ──`);
          for (const row of sampleRes.rows ?? []) {
            const preview = Object.entries(row)
              .filter(([, v]) => v != null && String(v).trim() !== "")
              .slice(0, 12)
              .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
              .join(" | ");
            console.log(`  ${preview}`);
          }
        }
      } catch {
        console.log(`  (sem permissão para SELECT na tabela)`);
      }
    }

    // ─── 4. Chaves e índices relevantes ──────────────────────────────────────
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`  CONSTRAINTS / PKs`);
    console.log(`════════════════════════════════════════════════════════════`);

    const uniqueOwners = [...new Set(Object.values(tableOwners))];
    for (const owner of uniqueOwners) {
      const ownedTables = TABLES.filter((t) => tableOwners[t] === owner);
      if (!ownedTables.length) continue;
      const ph = ownedTables.map((_, i) => `:c${i}`).join(",");
      const cb: Record<string, string> = { owner };
      ownedTables.forEach((t, i) => { cb[`c${i}`] = t; });

      const pkRes = await conn.execute<any>(
        `SELECT ac.TABLE_NAME, ac.CONSTRAINT_TYPE, acc.COLUMN_NAME, ac.R_CONSTRAINT_NAME
         FROM ALL_CONSTRAINTS ac
         JOIN ALL_CONS_COLUMNS acc ON acc.OWNER = ac.OWNER AND acc.CONSTRAINT_NAME = ac.CONSTRAINT_NAME
         WHERE ac.OWNER = :owner
           AND ac.TABLE_NAME IN (${ph})
           AND ac.CONSTRAINT_TYPE IN ('P','U','R')
         ORDER BY ac.TABLE_NAME, ac.CONSTRAINT_TYPE, acc.POSITION`,
        cb,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      for (const r of pkRes.rows ?? []) {
        const typeLabel = r.CONSTRAINT_TYPE === "P" ? "PK" : r.CONSTRAINT_TYPE === "U" ? "UQ" : "FK";
        const extra = r.R_CONSTRAINT_NAME ? `→ ${r.R_CONSTRAINT_NAME}` : "";
        console.log(`  ${r.TABLE_NAME.padEnd(14)} [${typeLabel}] ${r.COLUMN_NAME} ${extra}`);
      }
    }

  } finally {
    await conn.close();
    await pool.close(0);
  }
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
