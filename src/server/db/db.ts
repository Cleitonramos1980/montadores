import { executeOracle } from "./oracle";

type BindParameters = Record<string, unknown>;

function normalizeRow<T>(row: Record<string, unknown>): T {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    // Oracle unquoted columns come back ALL_CAPS — normalize to lowercase snake_case.
    // Quoted aliases (e.g. "averageScore") are already mixed-case and kept as-is.
    const key = k === k.toUpperCase() ? k.toLowerCase() : k;
    obj[key] = v;
  }
  return obj as T;
}

export async function queryRows<T>(sql: string, binds: BindParameters = {}): Promise<T[]> {
  const result = await executeOracle<Record<string, unknown>>(sql, binds);
  return ((result.rows as Record<string, unknown>[] | undefined) ?? []).map(normalizeRow<T>);
}

export async function queryOne<T>(sql: string, binds: BindParameters = {}): Promise<T | null> {
  const rows = await queryRows<T>(sql, binds);
  return rows[0] ?? null;
}

export async function execDml(sql: string, binds: BindParameters = {}): Promise<void> {
  await executeOracle(sql, binds);
}
