import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

export interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  roles: string[];
  exp: number;
  iat: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function b64url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function b64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function signJwt(payload: Omit<JwtPayload, "iat">): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = createHmac("sha256", config.jwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token inválido.");
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", config.jwtSecret).update(`${header}.${body}`).digest();
  const provided = Buffer.from(sig, "base64url");
  // timingSafeEqual exige buffers de mesmo tamanho e evita vazamento por timing
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("Token inválido.");
  }
  const payload = JSON.parse(b64urlDecode(body)) as JwtPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expirado. Faça login novamente.");
  return payload;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Autenticação obrigatória." });
    return;
  }
  try {
    req.user = verifyJwt(authHeader.slice(7));
    next();
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.roles.some((r) => roles.includes(r))) {
      res.status(403).json({ error: { message: "Acesso negado. Permissão insuficiente.", required: roles } });
      return;
    }
    next();
  };
}
