import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";

// Must mock before importing anything that touches Oracle/DB
vi.mock("../../src/server/db/oracle", () => ({
  isOracleEnabled: () => false,
  executeOracle: vi.fn(),
  initOraclePool: vi.fn(),
  closeOraclePool: vi.fn(),
}));
vi.mock("../../src/server/db/db", () => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryRows: vi.fn().mockResolvedValue([]),
  execDml: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
}));
vi.mock("../../src/server/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

import { createApp } from "../../src/server/app";

const app = createApp();

describe("GET /api/health", () => {
  it("returns 200 with ok=true when Oracle is disabled", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe("disabled");
  });

  it("includes X-Request-ID header in every response", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(typeof res.headers["x-request-id"]).toBe("string");
  });

  it("echoes back a caller-supplied X-Request-ID", async () => {
    const id = "trace-abc-123";
    const res = await request(app).get("/api/health").set("X-Request-ID", id);
    expect(res.headers["x-request-id"]).toBe(id);
  });

  it("generates distinct IDs for concurrent requests", async () => {
    const [a, b] = await Promise.all([
      request(app).get("/api/health"),
      request(app).get("/api/health"),
    ]);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });

  it("does not expose X-Powered-By", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
