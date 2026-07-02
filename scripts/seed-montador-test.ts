// Script one-shot: cria user MONTADOR de teste para bateria de regressão
import { initOraclePool, closeOraclePool } from "../src/server/db/oracle";
import { queryOne } from "../src/server/db/db";
import { AuthService } from "../src/server/services/AuthService";

await initOraclePool();

const auth = new AuthService();
const email = "test.montador.regress@example.com";
const password = "Montador@Regress1!";

const exists = await queryOne("SELECT ID FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)", { email });
if (exists) {
  console.log("[seed-montador] Usuário já existe:", email);
} else {
  await auth.createUser({ name: "Test Montador Regress", email, password, role: "MONTADOR" });
  console.log("[seed-montador] Criado:", email, "/ senha:", password);
}

await closeOraclePool();
process.exit(0);
