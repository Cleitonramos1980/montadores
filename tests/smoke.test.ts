/**
 * Smoke tests — basic API sanity checks.
 * Requires the server to be running at BASE_URL (default http://localhost:3333).
 * Run: npx vitest run tests/smoke.test.ts
 * Set SMOKE_TOKEN env var to a valid JWT to test authenticated routes.
 */

import { describe, expect, it } from "vitest";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3333";
const TOKEN = process.env.SMOKE_TOKEN ?? "";

async function get(path: string, auth = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}/api${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

async function post(path: string, body: unknown, auth = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("smoke: public endpoints", () => {
  it("GET /api/health returns 200 with ok/db fields", async () => {
    const { status, body } = await get("/health");
    expect(status).toBe(200);
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("db");
    expect(["ok", "disabled", "error"]).toContain(body.db);
  });

  it("POST /api/auth/login with bad creds returns 401", async () => {
    const { status } = await post("/auth/login", { email: "nobody@x.com", password: "wrong" });
    expect(status).toBe(401);
  });
});

describe("smoke: authenticated endpoints (require SMOKE_TOKEN)", () => {
  it.skipIf(!TOKEN)("GET /api/orders returns 200 array", async () => {
    const { status, body } = await get("/orders", true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/providers returns 200 array", async () => {
    const { status, body } = await get("/providers", true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/payments returns 200 array", async () => {
    const { status, body } = await get("/payments", true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skipIf(!TOKEN)("GET /api/notifications/summary returns numeric counts", async () => {
    const { status, body } = await get("/notifications/summary", true);
    expect(status).toBe(200);
    expect(body).toHaveProperty("total");
    expect(typeof body.total).toBe("number");
  });

  it.skipIf(!TOKEN)("GET /api/system/health returns db status", async () => {
    const { status, body } = await get("/system/health", true);
    expect(status).toBe(200);
    expect(body).toHaveProperty("db");
    expect(body.db).toHaveProperty("status");
  });
});
