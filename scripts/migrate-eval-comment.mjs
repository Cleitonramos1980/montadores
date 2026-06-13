// Renames COMMENT -> EVAL_COMMENT in MONT_EVAL_RESPONSES
// Run: node scripts/migrate-eval-comment.mjs
import oracledb from "oracledb";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "../.env");
dotenv.config({ path: envPath });

const cfg = {
  user:             process.env.ORACLE_USER,
  password:         process.env.ORACLE_PASSWORD,
  connectString:    process.env.ORACLE_CONNECT_STRING,
};

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let conn;
try {
  conn = await oracledb.getConnection(cfg);
  console.log("Conectado ao Oracle.");

  // Check if COMMENT column exists
  const colCheck = await conn.execute(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS
     WHERE TABLE_NAME = 'MONT_EVAL_RESPONSES' AND COLUMN_NAME = 'COMMENT'`
  );
  const hasComment = colCheck.rows.length > 0;

  // Check if EVAL_COMMENT already exists
  const evalColCheck = await conn.execute(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS
     WHERE TABLE_NAME = 'MONT_EVAL_RESPONSES' AND COLUMN_NAME = 'EVAL_COMMENT'`
  );
  const hasEvalComment = evalColCheck.rows.length > 0;

  console.log(`COMMENT exists: ${hasComment}`);
  console.log(`EVAL_COMMENT exists: ${hasEvalComment}`);

  if (hasComment && !hasEvalComment) {
    console.log("Renaming COMMENT -> EVAL_COMMENT ...");
    await conn.execute(`ALTER TABLE MONT_EVAL_RESPONSES RENAME COLUMN "COMMENT" TO EVAL_COMMENT`);
    console.log("✓ Coluna renomeada com sucesso.");
  } else if (!hasComment && !hasEvalComment) {
    console.log("Nenhuma das colunas existe. Adicionando EVAL_COMMENT...");
    await conn.execute(`ALTER TABLE MONT_EVAL_RESPONSES ADD (EVAL_COMMENT VARCHAR2(4000))`);
    console.log("✓ Coluna EVAL_COMMENT adicionada.");
  } else {
    console.log("✓ Nenhuma ação necessária.");
  }
} catch (err) {
  console.error("Erro:", err.message);
  process.exit(1);
} finally {
  if (conn) await conn.close();
}
