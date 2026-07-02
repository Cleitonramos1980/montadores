import type { Migration } from "./migrationRunner";
import { migration as m001 } from "./migrations/001_initial_schema";
import { migration as m002 } from "./migrations/002_job_queue";

// Adicione novas migrações aqui em ordem crescente de ID.
// NUNCA remova ou modifique migrações já aplicadas em produção.
export const ALL_MIGRATIONS: Migration[] = [
  m001,
  m002,
];
