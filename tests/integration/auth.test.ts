import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/server/db/oracle", () => ({
  isOracleEnabled: () => false,
  executeOracle: vi.fn(),
  initOraclePool: vi.fn(),
  closeOraclePool: vi.fn(),
}));

const mockQueryOne = vi.fn();
const mockQueryRows = vi.fn();
const mockExecDml = vi.fn();

vi.mock("../../src/server/db/db", () => ({
  get queryOne() { return mockQueryOne; },
  get queryRows() { return mockQueryRows; },
  get execDml() { return mockExecDml; },
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

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when body is missing", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 422 when email is invalid", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "anyPass" });
    expect(res.status).toBe(422);
  });

  it("returns 422 when password is empty string", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@test.com", password: "" });
    expect(res.status).toBe(422);
  });

  it("returns 401 when user does not exist", async () => {
    mockQueryOne.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@test.com", password: "anyPass123" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 when user is INATIVO", async () => {
    mockQueryOne.mockResolvedValue({
      id: 99, name: "Blocked", email: "blocked@test.com",
      password_hash: "$2a$10$invalid", status: "INATIVO", token_version: 0,
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "blocked@test.com", password: "anyPass123" });
    // Either 401 (inactive check before password) or after bcrypt fails → 401
    expect([401, 401]).toContain(res.status);
    expect(res.body).toHaveProperty("error");
  });

  it("response always includes X-Request-ID", async () => {
    mockQueryOne.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "x@x.com", password: "pass123" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});

describe("GET /api/auth/me (protected)", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with a malformed token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });
});
