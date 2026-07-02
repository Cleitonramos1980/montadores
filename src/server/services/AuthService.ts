import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { execDml, queryOne, queryRows } from "../db/db";
import { AppError, UnauthorizedError } from "../errors";
import { signJwt } from "../middleware/auth";

const BCRYPT_ROUNDS = 12;

function hashPasswordSha256(password: string): string {
  return createHash("sha256").update(`${password}:montadores:${config.jwtSecret}`).digest("hex");
}

function isBcryptHash(h: string): boolean {
  return h.startsWith("$2a$") || h.startsWith("$2b$") || h.startsWith("$2y$");
}

export class AuthService {
  async login(email: string, password: string) {
    const user = await queryOne<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      status: string;
    }>(
      "SELECT ID, NAME, EMAIL, PASSWORD_HASH, STATUS FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
      { email },
    );
    if (!user) throw new UnauthorizedError("Credenciais inválidas.");
    if (user.status !== "ATIVO") throw new UnauthorizedError("Usuário inativo ou bloqueado.");

    let validPassword = false;
    if (isBcryptHash(user.password_hash)) {
      validPassword = await bcrypt.compare(password, user.password_hash);
    } else {
      // Legacy SHA-256 path — verify and transparently re-hash to bcrypt on success
      const sha256Hash = hashPasswordSha256(password);
      if (sha256Hash === user.password_hash) {
        validPassword = true;
        const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await execDml(
          "UPDATE MONT_USERS SET PASSWORD_HASH = :hash, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
          { hash: newHash, id: user.id },
        );
      }
    }
    if (!validPassword) throw new UnauthorizedError("Credenciais inválidas.");

    const roles = await queryRows<{ name: string }>(
      `SELECT r.NAME FROM MONT_ROLES r
       JOIN MONT_USER_ROLES ur ON ur.ROLE_ID = r.ID
       WHERE ur.USER_ID = :userId`,
      { userId: user.id },
    );

    const roleNames = roles.map((r) => r.name);
    const token = signJwt({
      sub: user.id,
      name: user.name,
      email: user.email,
      roles: roleNames,
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
    if (!user) throw new AppError("Usuário não encontrado.", 404, "NOT_FOUND");
    const roles = await queryRows<{ name: string }>(
      `SELECT r.NAME FROM MONT_ROLES r JOIN MONT_USER_ROLES ur ON ur.ROLE_ID = r.ID WHERE ur.USER_ID = :userId`,
      { userId },
    );
    return { ...user, roles: roles.map((r) => r.name) };
  }

  // Kept for compatibility — internal use only. New code should use bcrypt directly.
  static hashPasswordLegacy(password: string): string {
    return hashPasswordSha256(password);
  }

  async createUser(data: { name: string; email: string; password: string; role?: string }) {
    const existing = await queryOne(
      "SELECT ID FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
      { email: data.email },
    );
    if (existing) throw new Error("E-mail já cadastrado.");
    const id = uuid();
    const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    await execDml(
      "INSERT INTO MONT_USERS (ID, NAME, EMAIL, PASSWORD_HASH, STATUS) VALUES (:id, :name, :email, :hash, 'ATIVO')",
      { id, name: data.name, email: data.email, hash },
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
