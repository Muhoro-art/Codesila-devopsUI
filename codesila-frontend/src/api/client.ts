const DEFAULT_API_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "http://127.0.0.1:3000";

export const API_BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

/**
 * Secure token storage using sessionStorage (clears on tab close).
 * In production, prefer httpOnly cookies set by the server.
 *
 * sessionStorage is less vulnerable than localStorage because:
 * - Data doesn't persist across browser restarts
 * - Data is isolated per tab
 * - Reduces window for token theft via XSS
 */
const TOKEN_STORAGE_KEY = "token";
const REFRESH_TOKEN_KEY = "refreshToken";

export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAuthToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getWebSocketBase() {
  if (API_BASE.startsWith("https://")) {
    return API_BASE.replace(/^https:\/\//, "wss://");
  }
  return API_BASE.replace(/^http:\/\//, "ws://");
}

/**
 * Returns auth headers or null if no token is available.
 * Callers should handle the null case gracefully (e.g. redirect to login).
 */
export function getAuthHeader(): { Authorization: string } | null {
  const token = getAuthToken();
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token if successful, null otherwise.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return null;
    }

    const data = await res.json();
    if (data.token) {
      setAuthToken(data.token);
    }
    if (data.refreshToken) {
      setRefreshToken(data.refreshToken);
    }
    return data.token || null;
  } catch {
    clearTokens();
    return null;
  }
}

/**
 * Authenticated fetch wrapper with automatic token refresh.
 * If a request returns 401, attempts to refresh the token once.
 */
export async function secureFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = { ...options.headers } as Record<string, string>;
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(url, { ...options, headers });

  // If unauthorized, try refreshing the token once
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(url, { ...options, headers });
    }
  }

  return res;
}

/**
 * Safe JSON response reader — handles non-JSON error responses gracefully.
 */
export async function readJsonResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? "Invalid response format" : `Server error: ${res.status}`);
  }
}

/**
 * Sanitize user-generated content before rendering.
 * Strips HTML tags to prevent XSS.
 */
export function sanitizeHtml(input: string): string {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}