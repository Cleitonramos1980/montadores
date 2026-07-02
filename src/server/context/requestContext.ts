import { AsyncLocalStorage } from "node:async_hooks";

interface RequestCtx {
  userId: string | undefined;
  ip: string | undefined;
  userAgent: string | undefined;
}

export const requestContext = new AsyncLocalStorage<RequestCtx>();

export function currentUserId(): string | undefined {
  return requestContext.getStore()?.userId;
}

export function currentIp(): string | undefined {
  return requestContext.getStore()?.ip;
}

export function currentUserAgent(): string | undefined {
  return requestContext.getStore()?.userAgent;
}
