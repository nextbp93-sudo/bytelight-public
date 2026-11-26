// The worker this dashboard talks to. Set VITE_MIND_URL in dashboard/.env.local
// (git-ignored); the fallback is a placeholder that will not answer.
const BASE_URL: string = (import.meta.env.VITE_MIND_URL || "https://your-worker.your-subdomain.workers.dev").replace(/\/+$/, "");
const STORAGE_KEY = "neuralis_api_key";

export class AuthRequiredError extends Error {
  constructor() {
    super("API key required");
    this.name = "AuthRequiredError";
  }
}

function getApiKey(): string {
  const key = localStorage.getItem(STORAGE_KEY);
  if (!key) throw new AuthRequiredError();
  return key;
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasApiKey(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearApiKey();
    throw new AuthRequiredError();
  }

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = params
    ? `${path}?${new URLSearchParams(params).toString()}`
    : path;
  return request<T>(url);
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export async function testConnection(): Promise<boolean> {
  try {
    await get<{ output: string }>("/api/health");
    return true;
  } catch {
    return false;
  }
}
