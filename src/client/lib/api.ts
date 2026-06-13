const base = "/api";

export function getToken(): string | null {
  return localStorage.getItem("montadores_token");
}

export function setToken(token: string): void {
  localStorage.setItem("montadores_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("montadores_token");
  localStorage.removeItem("montadores_user");
}

export function getStoredUser(): { name: string; email: string; roles: string[] } | null {
  try {
    const raw = localStorage.getItem("montadores_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasRole(...roles: string[]): boolean {
  const user = getStoredUser();
  if (!user?.roles?.length) return false;
  return roles.some((r) => user.roles.includes(r));
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  function errorMsg(fallback: string): string {
    const raw = data?.error;
    if (!raw) return fallback;
    if (typeof raw === "string") return raw;
    if (typeof raw === "object" && raw !== null) {
      if ("message" in raw && typeof raw.message === "string") return raw.message;
      return JSON.stringify(raw);
    }
    return String(raw);
  }

  if (response.status === 401) {
    clearToken();
    if (!path.startsWith("/auth/login") && !path.startsWith("/public/")) {
      location.href = "/montadores/login";
    }
    throw new Error(errorMsg("Sessão expirada. Faça login novamente."));
  }

  if (!response.ok) throw new Error(errorMsg("Falha na requisição"));
  return data as T;
}
