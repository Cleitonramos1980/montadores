import { initOraclePool } from "./oracle";
import { ensureMontadoresTables } from "./initTables";

await initOraclePool();
await ensureMontadoresTables();
console.log("Migrations Oracle aplicadas com sucesso.");
