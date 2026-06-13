import { createHash, randomBytes } from "node:crypto";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { execDml, queryOne } from "../db/db";

export class TokenService {
  async create(orderId: string, purpose: string) {
    const raw = randomBytes(32).toString("base64url");
    const token = createHash("sha256").update(raw).digest("hex");
    const expiresDate = new Date(Date.now() + config.publicTokenTtlHours * 60 * 60 * 1000);
    await execDml(
      `INSERT INTO MONT_PUBLIC_TOKENS (ID, TOKEN, ORDER_ID, PURPOSE, EXPIRES_AT)
       VALUES (:id, :token, :orderId, :purpose, :expiresAt)`,
      { id: uuid(), token, orderId, purpose, expiresAt: expiresDate },
    );
    return { token, expiresAt: expiresDate.toISOString(), url: `${config.appBaseUrl}/montadores/jornada-publica/${token}` };
  }

  async validate(token: string, purpose?: string) {
    const row = await queryOne<{ token: string; order_id: string; purpose: string; expires_at: string }>(
      "SELECT TOKEN, ORDER_ID, PURPOSE, EXPIRES_AT FROM MONT_PUBLIC_TOKENS WHERE TOKEN = :token",
      { token },
    );
    if (!row) throw new Error("Token não localizado.");
    if (purpose && row.purpose !== purpose) throw new Error("Token não autorizado para esta ação.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("Token expirado.");
    return row;
  }
}
