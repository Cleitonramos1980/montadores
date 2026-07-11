import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";

/**
 * Acesso a arquivos por URL assinada (HMAC-SHA256 + expiração), enviada na query
 * string — funciona em <img src> sem exigir header Authorization do browser.
 * Assina "<relPath>:<exp>". Gere o link com signFilePath ao devolver a URL do arquivo.
 */
export function signFilePath(relPath: string, ttlMs = 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const sig = createHmac("sha256", config.jwtSecret).update(`${relPath}:${exp}`).digest("base64url");
  return `?exp=${exp}&sig=${sig}`;
}

export function verifySignedFile(req: Request, res: Response, next: NextFunction): void {
  const relPath = decodeURIComponent(req.path.replace(/^\/+/, ""));
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig ?? "");
  if (!exp || Date.now() > exp) { res.status(403).json({ error: "Link expirado." }); return; }
  const expected = createHmac("sha256", config.jwtSecret).update(`${relPath}:${exp}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(403).json({ error: "Assinatura inválida." }); return; }
  next();
}
