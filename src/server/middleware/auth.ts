import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

export interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  roles: string[];
  tokenVersion?: number;
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

// Cache curto de STATUS + TOKEN_VERSION por usuário, para não consultar o banco
// a cada requisição. Revogação (desativar usuário / trocar senha) reflete em até TTL.
const REVOCATION_TTL_MS = 30_000;
const revocationCache = new Map<string, { status: string; version: number; expiresAt: number }>();

/**
 * Confere se o token ainda é válido contra o estado atual do usuário.
 * Rejeita se o usuário está inativo ou se TOKEN_VERSION avançou (senha trocada).
 * Fail-open em erro de banco: uma indisponibilidade do Oracle não deve trancar
 * todos os usuários — a janela de exposição é limitada pela expiração do token.
 */
async function isTokenRevoked(payload: JwtPayload): Promise<boolean> {
  const now = Date.now();
  let entry = revocationCache.get(payload.sub);
  if (!entry || entry.expiresAt < now) {
    try {
      const { queryOne } = await import("../db/db");
      const row = await queryOne<{ status: string; token_version: number }>(
        "SELECT STATUS, NVL(TOKEN_VERSION, 0) AS TOKEN_VERSION FROM MONT_USERS WHERE ID = :id",
        { id: payload.sub },
      );
      if (!row) return false; // usuário não confirmável — fail-open
      entry = { status: row.status, version: Number(row.token_version ?? 0), expiresAt: now + REVOCATION_TTL_MS };
      revocationCache.set(payload.sub, entry);
    } catch {
      return false; // banco indisponível — fail-open
    }
  }
  if (entry.status !== "ATIVO") return true;
  // Token sem tokenVersion: fail-CLOSED se o usuário já teve a versão incrementada
  // (TOKEN_VERSION > 0) — força re-login para invalidar tokens legados emitidos
  // antes de uma revogação. Só passa quando a versão do usuário ainda é 0.
  if (typeof payload.tokenVersion !== "number") return entry.version > 0;
  if (entry.version !== payload.tokenVersion) return true;
  return false;
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
  isTokenRevoked(payload)
    .then((revoked) => {
      if (revoked) {
        res.status(401).json({ error: "Sessão revogada. Faça login novamente." });
        return;
      }
      req.user = payload;
      next();
    })
    .catch(() => {
      // Qualquer falha inesperada na checagem não deve derrubar a requisição
      req.user = payload;
      next();
    });
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
