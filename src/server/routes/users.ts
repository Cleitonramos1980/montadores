import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import bcrypt from "bcrypt";
import { requireRole } from "../middleware/auth";
import { ConflictError, NotFoundError } from "../errors";
import { execDml, queryOne, queryRows } from "../db/db";
import { asyncRoute, param } from "../utils/route";
import { roles as allRoles } from "../../shared/domain";

export const usersRouter = Router();

const adminOnly = requireRole("ADMIN");

// ── List ──────────────────────────────────────────────────────────────────────

usersRouter.get("/users", adminOnly, asyncRoute(async (_req, res) => {
  const users = await queryRows<{
    id: string; name: string; email: string; status: string; created_at: string;
  }>(
    `SELECT ID, NAME, EMAIL, STATUS,
            TO_CHAR(CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS CREATED_AT
     FROM MONT_USERS
     ORDER BY CREATED_AT DESC`,
    {},
  );

  const rolesByUser = await queryRows<{ user_id: string; role_name: string }>(
    `SELECT ur.USER_ID, r.NAME AS ROLE_NAME
     FROM MONT_USER_ROLES ur
     JOIN MONT_ROLES r ON r.ID = ur.ROLE_ID`,
    {},
  );

  const rolesMap = new Map<string, string[]>();
  for (const row of rolesByUser) {
    const list = rolesMap.get(row.user_id) ?? [];
    list.push(row.role_name);
    rolesMap.set(row.user_id, list);
  }

  res.json(users.map((u) => ({ ...u, roles: rolesMap.get(u.id) ?? [] })));
}));

// ── Get single ────────────────────────────────────────────────────────────────

usersRouter.get("/users/:id", adminOnly, asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  const user = await queryOne<{ id: string; name: string; email: string; status: string; created_at: string }>(
    `SELECT ID, NAME, EMAIL, STATUS,
            TO_CHAR(CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS CREATED_AT
     FROM MONT_USERS WHERE ID = :id`,
    { id },
  );
  if (!user) throw new NotFoundError("Usuário");

  const userRoles = await queryRows<{ name: string }>(
    `SELECT r.NAME FROM MONT_ROLES r
     JOIN MONT_USER_ROLES ur ON ur.ROLE_ID = r.ID
     WHERE ur.USER_ID = :id`,
    { id },
  );
  res.json({ ...user, roles: userRoles.map((r) => r.name) });
}));

// ── Create ────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name:     z.string().min(2).max(255),
  email:    z.string().email(),
  password: z.string().min(8),
  roles:    z.array(z.string()).min(1).refine((rs) => rs.every((r) => (allRoles as readonly string[]).includes(r)), { message: "Role inválida" }),
  status:   z.enum(["ATIVO", "INATIVO"]).default("ATIVO"),
});

usersRouter.post("/users", adminOnly, asyncRoute(async (req, res) => {
  const body = createSchema.parse(req.body);

  const existing = await queryOne("SELECT ID FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)", { email: body.email });
  if (existing) throw new ConflictError("E-mail já cadastrado.");

  const id = uuid();
  const hash = await bcrypt.hash(body.password, 12);
  await execDml(
    "INSERT INTO MONT_USERS (ID, NAME, EMAIL, PASSWORD_HASH, STATUS) VALUES (:id, :name, :email, :hash, :status)",
    { id, name: body.name, email: body.email, hash, status: body.status },
  );

  for (const roleName of body.roles) {
    const role = await queryOne<{ id: string }>("SELECT ID FROM MONT_ROLES WHERE NAME = :name", { name: roleName });
    if (role) {
      await execDml("INSERT INTO MONT_USER_ROLES (USER_ID, ROLE_ID) VALUES (:u, :r)", { u: id, r: role.id });
    }
  }

  res.status(201).json({ id, name: body.name, email: body.email, roles: body.roles, status: body.status });
}));

// ── Update ────────────────────────────────────────────────────────────────────

const updateSchema = z.object({
  name:     z.string().min(2).max(255).optional(),
  status:   z.enum(["ATIVO", "INATIVO"]).optional(),
  password: z.string().min(8).optional(),
  roles:    z.array(z.string()).min(1).refine((rs) => rs.every((r) => (allRoles as readonly string[]).includes(r)), { message: "Role inválida" }).optional(),
});

usersRouter.patch("/users/:id", adminOnly, asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  const body = updateSchema.parse(req.body);

  const user = await queryOne<{ id: string }>("SELECT ID FROM MONT_USERS WHERE ID = :id", { id });
  if (!user) throw new NotFoundError("Usuário");

  const setParts: string[] = ["UPDATED_AT = SYSTIMESTAMP"];
  const binds: Record<string, unknown> = { id };

  if (body.name)     { setParts.push("NAME = :name");   binds.name = body.name; }
  if (body.status)   { setParts.push("STATUS = :status"); binds.status = body.status; }
  if (body.password) {
    setParts.push("PASSWORD_HASH = :hash", "TOKEN_VERSION = NVL(TOKEN_VERSION,0) + 1");
    binds.hash = await bcrypt.hash(body.password, 12);
  }

  if (setParts.length > 1) {
    await execDml(`UPDATE MONT_USERS SET ${setParts.join(", ")} WHERE ID = :id`, binds);
  }

  if (body.roles) {
    await execDml("DELETE FROM MONT_USER_ROLES WHERE USER_ID = :id", { id });
    for (const roleName of body.roles) {
      const role = await queryOne<{ id: string }>("SELECT ID FROM MONT_ROLES WHERE NAME = :name", { name: roleName });
      if (role) {
        await execDml("INSERT INTO MONT_USER_ROLES (USER_ID, ROLE_ID) VALUES (:u, :r)", { u: id, r: role.id });
      }
    }
  }

  res.json({ id, updated: true });
}));

// ── Deactivate ────────────────────────────────────────────────────────────────

usersRouter.delete("/users/:id", adminOnly, asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  if (id === req.user!.sub) throw new ConflictError("Não é possível desativar seu próprio usuário.");

  const user = await queryOne<{ id: string }>("SELECT ID FROM MONT_USERS WHERE ID = :id", { id });
  if (!user) throw new NotFoundError("Usuário");

  // Soft delete — incrementa token version para invalidar sessões ativas
  await execDml(
    "UPDATE MONT_USERS SET STATUS = 'INATIVO', TOKEN_VERSION = NVL(TOKEN_VERSION,0) + 1, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
    { id },
  );
  res.json({ id, status: "INATIVO" });
}));
