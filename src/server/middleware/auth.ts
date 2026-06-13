import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
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

// In-memory cache for token version checks — prevents fail-open when Oracle is offline
const _tokenVersionCache = new Map<string, { tokenVersion: number; fetchedAt: number }>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedVersion(userId: string): number | null {
  const cached = _tokenVersionCache.get(userId);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > TOKEN_CACHE_TTL_MS) {
    _tokenVersionCache.delete(userId);
    return null;
  }
  return cached.tokenVersion;
}

function setCachedVersion(userId: string, tokenVersion: number): void {
  _tokenVersionCache.set(userId, { tokenVersion, fetchedAt: Date.now() });
}

export function signJwt(payload: Omit<JwtPayload, "iat">): string {
  return jwt.sign(
    { ...payload, iat: Math.floor(Date.now() / 1000) },
    config.jwtSecret,
    { algorithm: "HS256" },
  );
}

export function verifyJwt(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as JwtPayload;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    throw new Error(
      msg.includes("expired") ? "Token expirado. Faça login novamente." : "Token inválido.",
    );
  }
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
    queryOne<{ token_version: number }>(
      "SELECT NVL(TOKEN_VERSION,0) AS TOKEN_VERSION FROM MONT_USERS WHERE ID = :id",
      { id: payload.sub },
    )
  ).then((row) => {
    if (row) {
      const dbVersion = Number(row.token_version ?? 0);
      setCachedVersion(payload.sub, dbVersion);
      if ((payload.tkv ?? 0) < dbVersion) {
        res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
        return;
      }
    }
    req.user = payload;
    next();
  }).catch(() => {
    // Oracle offline — use cached version; fail-closed if no cache entry
    const cachedVersion = getCachedVersion(payload.sub);
    if (cachedVersion !== null) {
      if ((payload.tkv ?? 0) < cachedVersion) {
        res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
        return;
      }
      req.user = payload;
      next();
    } else {
      res.status(503).json({ error: "Serviço temporariamente indisponível. Tente novamente em breve." });
    }
  });
}
