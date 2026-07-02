import type { Migration } from "../migrationRunner";
import { ensureMontadoresTables } from "../initTables";

export const migration: Migration = {
  id: "001_initial_schema",
  description: "Schema inicial — todas as tabelas MONT_* (idempotente via initTables)",
  async up() {
    await ensureMontadoresTables();
  },
};
