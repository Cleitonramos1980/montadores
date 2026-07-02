import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "../../src/server/errors";

describe("AppError hierarchy", () => {
  it("AppError carries statusCode and code", () => {
    const err = new AppError("ops", 418, "IM_A_TEAPOT");
    expect(err.message).toBe("ops");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("IM_A_TEAPOT");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof AppError).toBe(true);
  });

  it("NotFoundError → 404 NOT_FOUND", () => {
    const e = new NotFoundError("Pedido");
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toMatch(/Pedido/);
  });

  it("ForbiddenError → 403 FORBIDDEN", () => {
    const e = new ForbiddenError();
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe("FORBIDDEN");
  });

  it("UnauthorizedError → 401 UNAUTHORIZED", () => {
    const e = new UnauthorizedError("Token inválido.");
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("Token inválido.");
  });

  it("ConflictError → 409 CONFLICT", () => {
    const e = new ConflictError("E-mail já cadastrado.");
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe("CONFLICT");
  });

  it("ValidationError → 422 VALIDATION", () => {
    const e = new ValidationError("Senha muito curta.");
    expect(e.statusCode).toBe(422);
  });

  it("ServiceUnavailableError → 503", () => {
    const e = new ServiceUnavailableError();
    expect(e.statusCode).toBe(503);
  });

  it("instanceof checks work correctly", () => {
    const e = new NotFoundError();
    expect(e instanceof AppError).toBe(true);
    expect(e instanceof NotFoundError).toBe(true);
    expect(e instanceof ForbiddenError).toBe(false);
  });

  it("name reflects subclass", () => {
    expect(new NotFoundError().name).toBe("NotFoundError");
    expect(new ForbiddenError().name).toBe("ForbiddenError");
    expect(new UnauthorizedError().name).toBe("UnauthorizedError");
  });
});
