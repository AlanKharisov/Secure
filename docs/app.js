// app.js — легкий API-клієнт з Bearer-токеном Firebase
import { Auth } from "./firebase.js";

const API_BASE = ""; // той самий хост (app.world-of-photo.com)

export async function api(path, opts = {}) {
  const url = (API_BASE || "") + path;
  const method = (opts.method || "GET").toUpperCase();
  const headers = new Headers(opts.headers || {});
  let body = opts.body;

  // якщо тіло — обʼєкт, кодуємо в JSON
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    body = JSON.stringify(body);
  }

  // додаємо токен, якщо є
  try {
    const token = await Auth.idToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // На всяк випадок — X-User
    if (Auth.user?.email) headers.set("X-User", Auth.user.email);
  } catch (e) {
    // тихо ігноруємо — запит може бути публічний
  }

  const res = await fetch(url, { method, headers, body, credentials: "include" });

  // 204 No Content
  if (res.status === 204) return null;

  const ct = res.headers.get("Content-Type") || "";
  const isJSON = ct.includes("application/json");
  const data = isJSON ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const msg = isJSON ? (data?.error || data?.message || res.statusText) : ("" + data || res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data;
}
