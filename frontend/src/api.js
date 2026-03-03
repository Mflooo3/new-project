const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const API_KEY = import.meta.env.VITE_API_KEY || "";

function authHeaders() {
  if (!API_KEY) return {};
  return { "X-API-Key": API_KEY };
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders()
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost(path, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPatch(path, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiDownload(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders()
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || "";
  return { blob, filename };
}

export function streamEvents(onEvent) {
  const streamUrl = new URL(`${API_BASE}/stream`);
  if (API_KEY) {
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
