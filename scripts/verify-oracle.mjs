import "dotenv/config";
import oracledb from "oracledb";

const pool = await oracledb.createPool({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
  poolMin: 1, poolMax: 1,
});
const conn = await pool.getConnection();

// L-11: Verificar CODCLI piloto (347818)
const piloto = await conn.execute(
  "SELECT CODCLI, CLIENTE FROM PCCLIENT WHERE CODCLI = 347818",
  {},
  { outFormat: oracledb.OUT_FORMAT_OBJECT },
);
console.log("L-11 CODCLI 347818:", piloto.rows.length ? JSON.stringify(piloto.rows[0]) : "NAO ENCONTRADO");

// L-01: Tabelas MONT_EVAL_*
const evalTables = await conn.execute(
  "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'MONT_EVAL%' ORDER BY TABLE_NAME",
  {},
  { outFormat: oracledb.OUT_FORMAT_OBJECT },
);
console.log("L-01 MONT_EVAL_*:", evalTables.rows.map(r => r.TABLE_NAME));

// L-02/03/04: Tabelas comissão/notificação faltantes
const commTables = await conn.execute(
  `SELECT TABLE_NAME FROM USER_TABLES
   WHERE TABLE_NAME IN ('MONT_COMMISSION_CALC_ITEMS','MONT_DEPT_COMMISSIONS','MONT_PROVIDER_NOTIFICATIONS')
   ORDER BY TABLE_NAME`,
  {},
  { outFormat: oracledb.OUT_FORMAT_OBJECT },
);
console.log("L-02/03/04 existentes:", commTables.rows.map(r => r.TABLE_NAME));

// Verificar MONT_PROVIDER_PAYMENTS constraint UNIQUE em ASSEMBLY_JOB_ID
const uc = await conn.execute(
  `SELECT uc.CONSTRAINT_NAME, ucc.COLUMN_NAME
   FROM USER_CONSTRAINTS uc
   JOIN USER_CONS_COLUMNS ucc ON ucc.CONSTRAINT_NAME = uc.CONSTRAINT_NAME
   WHERE uc.TABLE_NAME = 'MONT_PROVIDER_PAYMENTS' AND uc.CONSTRAINT_TYPE = 'U'`,
  {},
  { outFormat: oracledb.OUT_FORMAT_OBJECT },
);
console.log("CC-07 UNIQUE em MONT_PROVIDER_PAYMENTS:", uc.rows.length ? JSON.stringify(uc.rows) : "NENHUMA");

await conn.close();
await pool.close();
