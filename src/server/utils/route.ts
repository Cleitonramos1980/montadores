import type { NextFunction, Request, Response } from "express";

export const param = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : String(v ?? "");

export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}
