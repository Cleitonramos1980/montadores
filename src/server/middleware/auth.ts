import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

export interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  roles: string[];
  filiais?: string[];
  tkv?: number;
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
  const expected = createHmac("sha256", config.jwtSecret).update(`${header}.${body}`).digest("base64url");
  if (sig !== expected) throw new Error("Assinatura do token inválida.");
  const payload = JSON.parse(b64urlDecode(body)) as JwtPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expirado. Faça login novamente.");
  return payload;
}

export function requireRole(...requiredRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles ?? [];
    if (!requiredRoles.some((r) => userRoles.includes(r))) {
      res.status(403).json({ error: "Acesso negado. Permissão insuficiente." });
      return;
    }
    next();
  };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Autenticação obrigatória." });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyJwt(authHeader.slice(7));
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
    return;
  }

  // Verify token version — revoke old tokens after password reset
  import("../db/db").then(({ queryOne }) =>
    queryOne<{ token_version: number; revoked_before: string | null }>(
      "SELECT NVL(TOKEN_VERSION,0) AS TOKEN_VERSION, REVOKED_BEFORE FROM MONT_USERS WHERE ID = :id",
      { id: payload.sub },
    )
  ).then((row) => {
    if (row) {
      const dbVersion = Number(row.token_version ?? 0);
      const tkv = payload.tkv ?? 0;
      if (tkv < dbVersion) {
        res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
        return;
      }
    }
    req.user = payload;
    next();
  }).catch(() => {
    // Fail open if DB is unavailable — do not lock out all users
    req.user = payload;
    next();
  });
}
