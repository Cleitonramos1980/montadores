import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { execDml, queryOne, queryRows } from "../db/db";
import { signJwt } from "../middleware/auth";

const BCRYPT_ROUNDS = 12;

function legacySha256Hash(password: string): string {
  return createHash("sha256").update(`${password}:montadores:${config.jwtSecret}`).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith("$2b$") || storedHash.startsWith("$2a$")) {
    return bcrypt.compare(password, storedHash);
  }
  // Legacy SHA-256 — migrated transparently on next login
  return legacySha256Hash(password) === storedHash;
}

export class AuthService {
  async login(email: string, password: string) {
    const user = await queryOne<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      status: string;
      token_version: number;
    }>(
      "SELECT ID, NAME, EMAIL, PASSWORD_HASH, STATUS, NVL(TOKEN_VERSION,0) AS TOKEN_VERSION FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
      { email },
    );
    if (!user) throw new Error("Credenciais inválidas.");
    if (user.status !== "ATIVO") throw new Error("Usuário inativo ou bloqueado.");

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) throw new Error("Credenciais inválidas.");

    // Migrate legacy SHA-256 hash to bcrypt on successful login
    if (!user.password_hash.startsWith("$2b$") && !user.password_hash.startsWith("$2a$")) {
      const newHash = await hashPassword(password);
      await execDml(
        "UPDATE MONT_USERS SET PASSWORD_HASH = :hash, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { hash: newHash, id: user.id },
      ).catch(() => {});
    }

    const [roles, filiaisRows] = await Promise.all([
      queryRows<{ name: string }>(
        `SELECT r.NAME FROM MONT_ROLES r
         JOIN MONT_USER_ROLES ur ON ur.ROLE_ID = r.ID
         WHERE ur.USER_ID = :userId`,
        { userId: user.id },
      ),
      queryRows<{ codfilial: string }>(
        "SELECT CODFILIAL FROM MONT_USER_FILIAIS WHERE USER_ID = :userId",
        { userId: user.id },
      ).catch(() => [] as { codfilial: string }[]),
    ]);

    const roleNames = roles.map((r) => r.name);
    const filiais = filiaisRows.map((f) => f.codfilial);
    const tokenVersion = Number((user as any).token_version ?? 0);
    const token = signJwt({
      sub: user.id,
      name: user.name,
      email: user.email,
      roles: roleNames,
      filiais: filiais.length > 0 ? filiais : undefined,
      tkv: tokenVersion,
      exp: Math.floor(Date.now() / 1000) + config.jwtExpiresHours * 3600,
    });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, roles: roleNames },
    };
  }

  async me(userId: string) {
    const user = await queryOne<{ id: string; name: string; email: string; status: string }>(
      "SELECT ID, NAME, EMAIL, STATUS FROM MONT_USERS WHERE ID = :id",
      { id: userId },
    );
    if (!user) throw new Error("Usuário não encontrado.");
    const roles = await queryRows<{ name: string }>(
      `SELECT r.NAME FROM MONT_ROLES r JOIN MONT_USER_ROLES ur ON ur.ROLE_ID = r.ID WHERE ur.USER_ID = :userId`,
      { userId },
    );
    return { ...user, roles: roles.map((r) => r.name) };
  }

  static hashPassword(password: string): string {
    return legacySha256Hash(password);
  }

  async forgotPassword(email: string): Promise<{ message: string; token?: string }> {
    const user = await queryOne<{ id: string; email: string; status: string }>(
      "SELECT ID, EMAIL, STATUS FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
      { email },
    );
    const msg = "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.";
    if (!user || user.status !== "ATIVO") return { message: msg };

    const tokenRaw = createHash("sha256").update(`${user.id}:${Date.now()}:${Math.random()}`).digest("hex");
    const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");
    const expiresAt = new Date(Date.now() + 3600_000); // 1 h

    await execDml("DELETE FROM MONT_PASSWORD_RESET_TOKENS WHERE USER_ID = :userId", { userId: user.id });
    await execDml(
      `INSERT INTO MONT_PASSWORD_RESET_TOKENS (ID, USER_ID, TOKEN_HASH, EXPIRES_AT)
       VALUES (:id, :userId, :tokenHash, :expiresAt)`,
      { id: uuid(), userId: user.id, tokenHash, expiresAt },
    );

    // DRY_RUN — token exposed only in non-production for admin use
    console.log(`[AuthService] Reset token ${user.email}: ${tokenRaw}`);
    if (!config.isProduction) {
      return { message: msg, token: tokenRaw };
    }
    return { message: msg };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) throw new Error("Nova senha deve ter ao menos 6 caracteres.");

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = await queryOne<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
      "SELECT ID, USER_ID, TO_CHAR(EXPIRES_AT, 'YYYY-MM-DD HH24:MI:SS') AS EXPIRES_AT, USED_AT FROM MONT_PASSWORD_RESET_TOKENS WHERE TOKEN_HASH = :tokenHash",
      { tokenHash },
    );

    if (!record) throw new Error("Token inválido ou expirado.");
    if (record.used_at) throw new Error("Este link de recuperação já foi utilizado.");
    if (new Date() > new Date(record.expires_at)) throw new Error("Token expirado. Solicite um novo link.");

    await execDml(
      "UPDATE MONT_USERS SET PASSWORD_HASH = :hash, TOKEN_VERSION = NVL(TOKEN_VERSION,0) + 1, REVOKED_BEFORE = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { hash: await hashPassword(newPassword), id: record.user_id },
    );
    await execDml(
      "UPDATE MONT_PASSWORD_RESET_TOKENS SET USED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: record.id },
    );
  }

  async createUser(data: { name: string; email: string; password: string; role?: string }) {
    const existing = await queryOne(
      "SELECT ID FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
      { email: data.email },
    );
    if (existing) throw new Error("E-mail já cadastrado.");
    const id = uuid();
    await execDml(
      "INSERT INTO MONT_USERS (ID, NAME, EMAIL, PASSWORD_HASH, STATUS) VALUES (:id, :name, :email, :hash, 'ATIVO')",
      { id, name: data.name, email: data.email, hash: await hashPassword(data.password) },
    );
    if (data.role) {
      const role = await queryOne<{ id: string }>(
        "SELECT ID FROM MONT_ROLES WHERE NAME = :name",
        { name: data.role },
      );
      if (role) {
        await execDml(
          "INSERT INTO MONT_USER_ROLES (USER_ID, ROLE_ID) VALUES (:userId, :roleId)",
          { userId: id, roleId: role.id },
        );
      }
    }
    return { id };
  }
}
