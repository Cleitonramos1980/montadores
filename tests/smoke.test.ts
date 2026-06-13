/**
 * Smoke tests — basic API sanity checks.
 * Requires the server to be running at BASE_URL (default http://localhost:3333).
 * Run: npx vitest run tests/smoke.test.ts
 * Set SMOKE_TOKEN env var to a valid JWT (ADMIN/GESTOR role) for authenticated route tests.
 * Set SMOKE_RESTRICTED_TOKEN env var to a JWT with MONTADOR role for RBAC 403 tests.
 */

import { describe, expect, it } from "vitest";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3333";
const TOKEN = process.env.SMOKE_TOKEN ?? "";
const RESTRICTED_TOKEN = process.env.SMOKE_RESTRICTED_TOKEN ?? "";

async function req(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: { auth?: "admin" | "restricted" | "none"; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth === "admin" && TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  if (opts.auth === "restricted" && RESTRICTED_TOKEN) headers["Authorization"] = `Bearer ${RESTRICTED_TOKEN}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

const get  = (path: string, auth: "admin" | "restricted" | "none" = "none") => req("GET",  path, { auth });
const post = (path: string, body: unknown, auth: "admin" | "restricted" | "none" = "none") => req("POST", path, { auth, body });

describe("smoke: public endpoints", () => {
  it("GET /api/health returns 200 with ok/db fields", async () => {
    const { status, body } = await get("/health");
    expect(status).toBe(200);
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("db");
    expect(["ok", "disabled", "error"]).toContain((body as Record<string, string>).db);
  });

  it("POST /api/auth/login with bad creds returns 401", async () => {
    const { status } = await post("/auth/login", { email: "nobody@x.com", password: "wrong" });
    expect(status).toBe(401);
  });
});

describe("smoke: RBAC — unauthenticated requests return 401", () => {
  it("GET /api/commissions (no token) → 401", async () => {
    const { status } = await get("/commissions");
    expect(status).toBe(401);
  });

  it("PUT /api/commissions/:codprod (no token) → 401", async () => {
    const { status } = await req("PUT", "/commissions/99999", { body: {} });
    expect(status).toBe(401);
  });

  it("DELETE /api/commissions/:codprod (no token) → 401", async () => {
    const { status } = await req("DELETE", "/commissions/99999");
    expect(status).toBe(401);
  });

  it("GET /api/audit-logs (no token) → 401", async () => {
    const { status } = await get("/audit-logs");
    expect(status).toBe(401);
  });

  it("GET /api/agenda/candidatos (no token) → 401", async () => {
    const { status } = await get("/agenda/candidatos");
    expect(status).toBe(401);
  });
});

describe("smoke: RBAC — insufficient-role requests return 403 (require SMOKE_RESTRICTED_TOKEN)", () => {
  it.skipIf(!RESTRICTED_TOKEN)("PUT /api/commissions/:codprod with MONTADOR token → 403", async () => {
    const { status } = await req("PUT", "/commissions/99999", { auth: "restricted", body: { commissionPercent: 5 } });
    expect(status).toBe(403);
  });

  it.skipIf(!RESTRICTED_TOKEN)("DELETE /api/commissions/:codprod with MONTADOR token → 403", async () => {
    const { status } = await req("DELETE", "/commissions/99999", { auth: "restricted" });
    expect(status).toBe(403);
  });

  it.skipIf(!RESTRICTED_TOKEN)("GET /api/audit-logs with MONTADOR token → 403", async () => {
    const { status } = await get("/audit-logs", "restricted");
    expect(status).toBe(403);
  });

  it.skipIf(!RESTRICTED_TOKEN)("DELETE /api/commissions/dept/:codepto with MONTADOR token → 403", async () => {
    const { status } = await req("DELETE", "/commissions/dept/99", { auth: "restricted" });
    expect(status).toBe(403);
  });
});

describe("smoke: authenticated endpoints (require SMOKE_TOKEN)", () => {
  it.skipIf(!TOKEN)("GET /api/orders returns 200 array", async () => {
    const { status, body } = await get("/orders", "admin");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/providers returns 200 array", async () => {
    const { status, body } = await get("/providers", "admin");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/payments returns 200 array", async () => {
    const { status, body } = await get("/payments", "admin");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/notifications/summary returns numeric counts", async () => {
    const { status, body } = await get("/notifications/summary", "admin");
    expect(status).toBe(200);
    expect(body).toHaveProperty("total");
    expect(typeof (body as Record<string, unknown>).total).toBe("number");
  });

  it.skipIf(!TOKEN)("GET /api/system/health returns db status", async () => {
    const { status, body } = await get("/system/health", "admin");
    expect(status).toBe(200);
    expect(body).toHaveProperty("db");
    expect((body as Record<string, unknown>).db).toHaveProperty("status");
  });

  it.skipIf(!TOKEN)("GET /api/commissions (ADMIN) returns 200 array", async () => {
    const { status, body } = await get("/commissions", "admin");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/audit-logs (ADMIN) returns 200 array", async () => {
    const { status, body } = await get("/audit-logs", "admin");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/pix/mode returns valid PIX mode string", async () => {
    const { status, body } = await get("/pix/mode", "admin");
    expect(status).toBe(200);
    expect(body).toHaveProperty("mode");
    expect(["PIX_DISABLED", "PIX_SANDBOX", "PIX_PRODUCTION"]).toContain((body as Record<string, string>).mode);
  });

  it.skipIf(!TOKEN)("GET /api/reworks returns 200 array", async () => {
    const { status, body } = await get("/reworks", "admin");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/agenda/providers-match without query → 400 or 200", async () => {
    const { status } = await get("/agenda/providers-match", "admin");
    // Without required query params may return 400 or 200 with empty — both are valid server responses (not 500)
    expect([200, 400]).toContain(status);
  });
});
