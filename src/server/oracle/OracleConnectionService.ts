import oracledb from "oracledb";
import { config } from "../config";

export class OracleConnectionService {
  private pool: any | null = null;

  isConfigured() {
    return Boolean(config.oracle.user && config.oracle.password && config.oracle.connectString);
  }

  async getPool() {
    if (!this.isConfigured()) {
      throw new Error("Oracle não configurado. Defina ORACLE_USER, ORACLE_PASSWORD e ORACLE_CONNECT_STRING.");
    }
    if (!this.pool) {
      this.pool = await oracledb.createPool({
        user: config.oracle.user,
        password: config.oracle.password,
        connectString: config.oracle.connectString,
        poolMin: config.oracle.poolMin,
        poolMax: config.oracle.poolMax,
        poolIncrement: config.oracle.poolIncrement
      });
    }
    return this.pool;
  }

  async execute<T>(sql: string, binds: Record<string, unknown>, queryName: string): Promise<T[]> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (result.rows ?? []) as T[];
    } catch (error) {
      throw new Error(`${queryName}: ${(error as Error).message}`);
    } finally {
      await conn.close();
    }
  }
}
