function resolveDefaultApiBase() {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol || "http:";
    const host = window.location.hostname || "localhost";
    const port = String(window.location.port || "");
    const hostWithPort = window.location.host || host;
    if (port === "5174") return `${protocol}//${host}:8012`;
    if (port === "5173") return `${protocol}//${host}:8010`;
    return `${protocol}//${hostWithPort}/api`;
  }
  return "http://localhost:8012";
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || resolveDefaultApiBase();
const API_KEY = import.meta.env.VITE_API_KEY || "";
const AUTH_STORAGE_KEY = "gulf_monitor_auth_v1";
const AUTH_STATE_EVENT = "gulf_monitor_auth_state";
const API_REQUEST_TIMEOUT_MS = Math.max(5000, Number(import.meta.env.VITE_API_REQUEST_TIMEOUT_MS || 45000));
const LOGOUT_REQUEST_TIMEOUT_MS = Math.max(1000, Number(import.meta.env.VITE_LOGOUT_REQUEST_TIMEOUT_MS || 3500));

function readAuthStorage() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAuthStorage(value) {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_STATE_EVENT, { detail: null }));
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(AUTH_STATE_EVENT, { detail: value }));
}

export function getStoredAuth() {
  return readAuthStorage();
}

export function setStoredAuth(auth) {
  writeAuthStorage(auth);
}

export function clearStoredAuth() {
  writeAuthStorage(null);
}

export function onAuthStateChange(handler) {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};
  const onCustom = (event) => handler(event?.detail ?? readAuthStorage());
  const onStorage = (event) => {
    if (event?.key === AUTH_STORAGE_KEY) handler(readAuthStorage());
  };
  window.addEventListener(AUTH_STATE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTH_STATE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

function _makeTimeoutPromise(timeoutMs, message) {
  return new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(message || "Request timeout"));
    }, timeoutMs);
  });
}

async function _fetchWithTimeout(url, init = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutError = new Error("Connection timeout. Please try again.");
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function _tokenHeaders() {
  const auth = readAuthStorage();
  const headers = {};
  if (auth?.access_token) {
    headers.Authorization = `Bearer ${auth.access_token}`;
  } else if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }
  return headers;
}

async function _refreshAccessToken() {
  const auth = readAuthStorage();
  if (!auth?.refresh_token) return null;
  const res = await _fetchWithTimeout(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: auth.refresh_token })
  }, API_REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    clearStoredAuth();
    return null;
  }
  const payload = await res.json();
  const merged = {
    ...auth,
    ...payload,
    user: payload?.user || auth.user
  };
  setStoredAuth(merged);
  return merged;
}

async function _request(path, init = {}, retryOnAuth = true) {
  const headers = {
    ...(init.headers || {}),
    ..._tokenHeaders(),
  };
  const res = await _fetchWithTimeout(`${API_BASE}${path}`, { ...init, headers }, API_REQUEST_TIMEOUT_MS);
  if (res.status === 401 && retryOnAuth && !path.startsWith("/auth/")) {
    const refreshed = await _refreshAccessToken();
    if (refreshed?.access_token) {
      return _request(path, init, false);
    }
  }
  return res;
}

async function _parseError(res, method, path) {
  let detail = "";
  try {
    const payload = await res.json();
    if (payload?.detail) {
      detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
    }
  } catch {
    // ignore non-json errors
  }
  const authPath = String(path || "").toLowerCase();
  const isPublicAuthFlow =
    authPath === "/auth/login" ||
    authPath === "/auth/verify-otp" ||
    authPath === "/auth/request-otp" ||
    authPath === "/auth/register" ||
    authPath === "/auth/password-reset/request" ||
    authPath === "/auth/password-reset/confirm";
  if (res.status === 401) {
    if (readAuthStorage()?.access_token && !isPublicAuthFlow) {
      clearStoredAuth();
      const unauthorized = new Error("Session expired. Please sign in again.");
      unauthorized.status = res.status;
      unauthorized.detail = detail;
      throw unauthorized;
    }
    const authFailure = new Error(detail || "Login failed. Verify your credentials and try again.");
    authFailure.status = res.status;
    authFailure.detail = detail;
    throw authFailure;
  }
  if (res.status === 403 && /access denied: this feature requires/i.test(detail || "")) {
    const denied = new Error("You do not have access to this feature. Ask your admin to upgrade this account to V2.");
    denied.status = res.status;
    denied.detail = detail;
    throw denied;
  }
  if (res.status === 403 && /permission for page/i.test(detail || "")) {
    const denied = new Error("You do not have access to this page. Ask your system admin to update your permissions.");
    denied.status = res.status;
    denied.detail = detail;
    throw denied;
  }
  const message = detail || `${method} ${path} failed: ${res.status}`;
  const error = new Error(message);
  error.status = res.status;
  error.detail = detail;
  throw error;
}

export async function apiGet(path) {
  const res = await _request(path, { method: "GET" });
  if (!res.ok) await _parseError(res, "GET", path);
  return res.json();
}

export async function apiPost(path, body = {}) {
  const res = await _request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await _parseError(res, "POST", path);
  return res.json();
}

export async function apiPatch(path, body = {}) {
  const res = await _request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await _parseError(res, "PATCH", path);
  return res.json();
}

export async function apiDelete(path, body = null) {
  const res = await _request(path, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) await _parseError(res, "DELETE", path);
  return res.json();
}

export async function apiDownload(path) {
  const res = await _request(path, { method: "GET" });
  if (!res.ok) await _parseError(res, "GET", path);
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^\"]+)"?/i);
  const filename = match?.[1] || "";
  return { blob, filename };
}

export function streamEvents(onEvent) {
  const streamEndpoint = `${API_BASE}/stream`;
  const streamUrl =
    typeof window !== "undefined"
      ? new URL(streamEndpoint, window.location.origin)
      : new URL(streamEndpoint, "http://localhost");
  const auth = readAuthStorage();
  if (auth?.access_token) {
    streamUrl.searchParams.set("access_token", auth.access_token);
  } else if (API_KEY) {
    streamUrl.searchParams.set("api_key", API_KEY);
  }
  const stream = new EventSource(streamUrl.toString());
  stream.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      onEvent(payload);
    } catch {
      // ignore malformed stream messages
    }
  };
  return () => stream.close();
}

export async function authRegister(payload) {
  return apiPost("/auth/register", payload);
}

export async function authLogin(payload) {
  const row = await apiPost("/auth/login", payload);
  setStoredAuth(row);
  return row;
}

export async function authRequestOtp(payload) {
  return apiPost("/auth/request-otp", payload);
}

export async function authRequestPasswordReset(payload) {
  return apiPost("/auth/password-reset/request", payload);
}

export async function authConfirmPasswordReset(payload) {
  return apiPost("/auth/password-reset/confirm", payload);
}

export async function authVerifyOtp(payload) {
  const row = await apiPost("/auth/verify-otp", payload);
  setStoredAuth(row);
  return row;
}

export async function authLogout(refreshTokenOverride = null) {
  const auth = readAuthStorage();
  const refreshToken = refreshTokenOverride || auth?.refresh_token || null;
  try {
    if (refreshToken) {
      await Promise.race([
        apiPost("/auth/logout", { refresh_token: refreshToken }),
        _makeTimeoutPromise(LOGOUT_REQUEST_TIMEOUT_MS, "Logout timeout"),
      ]);
    } else {
      await Promise.race([apiPost("/auth/logout", {}), _makeTimeoutPromise(LOGOUT_REQUEST_TIMEOUT_MS, "Logout timeout")]);
    }
  } catch {
    // Ignore logout API errors and clear local session anyway.
  } finally {
    clearStoredAuth();
  }
}

export async function authMe() {
  return apiGet("/auth/me");
}

export async function authTotpStatus() {
  return apiGet("/auth/totp/status");
}

export async function authTotpSetupStart(payload) {
  return apiPost("/auth/totp/setup-start", payload);
}

export async function authTotpSetupVerify(payload) {
  return apiPost("/auth/totp/setup-verify", payload);
}

export async function authTotpDisable(payload) {
  return apiPost("/auth/totp/disable", payload);
}

export async function adminGetPlatformFlags() {
  return apiGet("/admin/platform/flags");
}

export async function adminUpdatePlatformFlags(payload) {
  return apiPatch("/admin/platform/flags", payload);
}



