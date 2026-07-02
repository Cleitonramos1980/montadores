import "dotenv/config";
import bcrypt from "bcrypt";
import oracledb from "oracledb";

const email = process.argv[2] || "cleiton.ramos@hotmail.com";
const newPassword = process.argv[3] || "Admin@2026!";

const pool = await oracledb.createPool({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
  poolMin: 1, poolMax: 1,
});
const conn = await pool.getConnection();

const hash = await bcrypt.hash(newPassword, 12);
const result = await conn.execute(
  "UPDATE MONT_USERS SET PASSWORD_HASH = :hash, STATUS = 'ATIVO', UPDATED_AT = SYSTIMESTAMP WHERE LOWER(EMAIL) = LOWER(:email)",
  { hash, email },
  { autoCommit: true },
);
console.log(`Rows updated: ${result.rowsAffected}`);
if (result.rowsAffected === 0) {
  const check = await conn.execute(
    "SELECT ID, NAME, EMAIL, STATUS FROM MONT_USERS WHERE ROWNUM <= 10",
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  console.log("Users in DB:", JSON.stringify(check.rows, null, 2));
}
await conn.close();
await pool.close();
