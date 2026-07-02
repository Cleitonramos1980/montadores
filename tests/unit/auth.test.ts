import { describe, expect, it, vi } from "vitest";
import { signJwt, verifyJwt } from "../../src/server/middleware/auth";

describe("JWT helpers", () => {
  const payload = {
    sub: "user-123",
    name: "Test User",
    email: "test@example.com",
    roles: ["ADMIN"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  it("signJwt produces a valid JWT string", () => {
    const token = signJwt(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifyJwt round-trips with same payload", () => {
    const token = signJwt(payload);
    const decoded = verifyJwt(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.roles).toEqual(payload.roles);
  });

  it("verifyJwt throws on tampered token", () => {
    const token = signJwt(payload);
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "hacker", roles: ["ADMIN"], exp: 9999999999 })).toString("base64url");
    const tampered = parts.join(".");
    expect(() => verifyJwt(tampered)).toThrow("Token inválido.");
  });

  it("verifyJwt throws on expired token", () => {
    // Sign using signJwt (which uses the real config.jwtSecret) with past exp
    const expired = signJwt({
      sub: "x", name: "x", email: "x@x.com", roles: [],
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    expect(() => verifyJwt(expired)).toThrow("Token expirado.");
  });

  it("verifyJwt throws on completely invalid string", () => {
    expect(() => verifyJwt("not-a-token")).toThrow("Token inválido.");
  });
});

import { requireRole } from "../../src/server/middleware/auth";

describe("requireRole middleware", () => {
  it("is exported and callable", () => {
    const mw = requireRole("ADMIN");
    expect(typeof mw).toBe("function");
  });

  it("calls res.status(403) when user lacks role", () => {
    const mw = requireRole("ADMIN");
    const req = { user: { roles: ["MONTADOR"] } } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    const next = vi.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when user has required role", () => {
    const mw = requireRole("ADMIN", "GESTOR");
    const req = { user: { roles: ["GESTOR"] } } as any;
    const res = {} as any;
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
