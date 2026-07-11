import { executeOracle, withOracleConnection } from "./oracle";

type BindParameters = Record<string, unknown>;

/** Executor com escopo de transação — todos os statements na mesma conexão. */
export interface Tx {
  exec(sql: string, binds?: BindParameters): Promise<void>;
  queryOne<T>(sql: string, binds?: BindParameters): Promise<T | null>;
}

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

/**
 * Executa uma sequência de statements como UMA transação atômica (mesma conexão,
 * autoCommit off). Commit no sucesso, rollback em qualquer erro. Use quando várias
 * escritas precisam ser tudo-ou-nada (ex.: pagamento, resposta de avaliação).
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withOracleConnection(async (conn: any) => {
    const tx: Tx = {
      async exec(sql, binds = {}) {
        await conn.execute(sql, binds, { autoCommit: false });
      },
      async queryOne<U>(sql: string, binds: BindParameters = {}): Promise<U | null> {
        const res = await conn.execute(sql, binds, { outFormat: 4002 /* OUT_FORMAT_OBJECT */, autoCommit: false });
        const row = (res.rows as Record<string, unknown>[] | undefined)?.[0];
        return row ? normalizeRow<U>(row) : null;
      },
    };
    try {
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    }
  });
}
