// =============================================================================
// AVISO: NÃO utilizado no boot atual.
// -----------------------------------------------------------------------------
// Este catálogo de migrações versionadas NÃO é executado na inicialização.
// O schema real das tabelas MONT_* é criado por src/server/db/initTables.ts
// (ensureMontadoresTables), idempotente, que é o caminho efetivo no boot.
// Mantido como referência/infra; ver o cabeçalho de migrationRunner.ts.
// =============================================================================
import type { Migration } from "./migrationRunner";
import { migration as m001 } from "./migrations/001_initial_schema";
import { migration as m002 } from "./migrations/002_job_queue";

// Adicione novas migrações aqui em ordem crescente de ID.
// NUNCA remova ou modifique migrações já aplicadas em produção.
export const ALL_MIGRATIONS: Migration[] = [
  m001,
  m002,
];
