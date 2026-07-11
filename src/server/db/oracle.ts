import oracledb from "oracledb";
import { config } from "../config";

type BindParameters = Record<string, unknown>;
type OracleResult<T = unknown> = { rows?: T[] };

let initialized = false;

export async function initOraclePool(): Promise<void> {
  if (initialized) return;
  oracledb.fetchAsString = [oracledb.CLOB];
  await oracledb.createPool({
    user: config.oracle.user,
    password: config.oracle.password,
    connectString: config.oracle.connectString,
    poolAlias: config.oracle.poolAlias,
    poolMin: config.oracle.poolMin,
    poolMax: config.oracle.poolMax,
    poolIncrement: config.oracle.poolIncrement,
    stmtCacheSize: config.oracle.stmtCacheSize,
  });
  initialized = true;
}

export function isOracleEnabled(): boolean {
  return Boolean(config.oracle.user && config.oracle.password && config.oracle.connectString);
}

export function isOraclePoolInitialized(): boolean {
  return initialized;
}

export async function closeOraclePool(): Promise<void> {
  if (!initialized) return;
  await oracledb.getPool(config.oracle.poolAlias).close(10);
  initialized = false;
}

// Aborta qualquer round-trip que exceda este tempo, evitando que uma query pendurada
// segure a conexão para sempre e esgote o pool (travando toda a API).
const CALL_TIMEOUT_MS = Number(process.env.ORACLE_CALL_TIMEOUT_MS ?? 30_000);

export async function withOracleConnection<T>(handler: (connection: any) => Promise<T>): Promise<T> {
  const pool = oracledb.getPool(config.oracle.poolAlias);
  const connection = await pool.getConnection();
  try {
    connection.callTimeout = CALL_TIMEOUT_MS;
    return await handler(connection);
  } finally {
    await connection.close();
  }
}

export async function executeOracle<T = unknown>(
  sql: string,
  binds: BindParameters = {},
  options?: Record<string, unknown>,
): Promise<OracleResult<T>> {
  return withOracleConnection(async (connection) => {
    return (await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      ...(options ?? {}),
    })) as OracleResult<T>;
  });
}
