// app.js — легкий API-клієнт з Bearer-токеном Firebase
import { Auth } from "./firebase.js";

export async function api(path, opts = {}) {
  const url = path; // той самий хост
  const method = (opts.method || "GET").toUpperCase();
  const headers = new Headers(opts.headers || {});
  let body = opts.body;

  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    body = JSON.stringify(body);
  }

  try {
    const t = await Auth.idToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
    if (Auth.user?.email) headers.set("X-User", Auth.user.email);
  } catch {}

  const res = await fetch(url, { method, headers, body, credentials: "include" });
  const ct = res.headers.get("Content-Type") || "";
  const isJSON = ct.includes("application/json");
  const data = isJSON ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const msg = isJSON ? (data?.error || data?.message) : String(data);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data;
}
