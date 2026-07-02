import "dotenv/config";
import bcrypt from "bcrypt";
import oracledb from "oracledb";

const email = process.argv[2] || "cleiton.ramos@hotmail.com";
const testPassword = process.argv[3] || "Admin@2026!";

const pool = await oracledb.createPool({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
  poolMin: 1, poolMax: 1,
});
const conn = await pool.getConnection();

const result = await conn.execute(
  "SELECT ID, NAME, EMAIL, STATUS, PASSWORD_HASH FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
  { email },
  { outFormat: oracledb.OUT_FORMAT_OBJECT },
);

if (!result.rows.length) {
  console.log("Usuário NÃO encontrado. Listando todos:");
  const all = await conn.execute(
    "SELECT ID, NAME, EMAIL, STATUS FROM MONT_USERS",
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  console.log(JSON.stringify(all.rows, null, 2));
} else {
  const user = result.rows[0];
  console.log("ID:", user.ID);
  console.log("Nome:", user.NAME);
  console.log("Email:", user.EMAIL);
  console.log("Status:", user.STATUS);
  console.log("Hash prefix:", user.PASSWORD_HASH?.substring(0, 10));
  const valid = await bcrypt.compare(testPassword, user.PASSWORD_HASH);
  console.log(`Senha '${testPassword}' válida?`, valid);
}

await conn.close();
await pool.close();
