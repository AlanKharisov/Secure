import { Auth } from "./firebase.js";

/** База для API — поточний origin (локально і на проді однаково) */
export const API = location.origin;

/** Хелпери DOM */
export const qs  = (s, r=document) => r.querySelector(s);
export const qsa = (s, r=document) => [...r.querySelectorAll(s)];
export const h = (tag, attrs={}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
};

/** універсальний виклик API з токеном + dev X-User */
export async function api(path, { method="GET", body=null, headers={} } = {}) {
  const token = await Auth.idToken().catch(() => "");
  const email = (Auth.user?.email || "").trim().toLowerCase();

  const baseHeaders = { "Content-Type": "application/json" };
  if (email) baseHeaders["X-User"] = email;              // dev-фолбек на беку
  if (token) baseHeaders["Authorization"] = "Bearer " + token;

  const opts = { method, headers: { ...baseHeaders, ...headers } };
  if (body != null) opts.body = typeof body === "string" ? body : JSON.stringify(body);

  const res = await fetch(API + path, opts);
  const isJSON = (res.headers.get("Content-Type") || "").includes("application/json");
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (isJSON) { try { const e = await res.json(); if (e?.error) msg = e.error; } catch {} }
    throw new Error(msg);
  }
  return isJSON ? res.json() : res.text();
}

/** flash */
export function flash(msg, ms = 3000) {
  const box = qs("#flash");
  if (!box) return;
  box.textContent = msg;
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), ms);
}

/** Побудова URL деталей з поточного домену */
export function productUrl(tokenId) {
  return `${location.origin}/details.html?id=${encodeURIComponent(tokenId)}`;
}

/** QR helper: якщо є глобальна QRCode — використає її; інакше CDN fallback у main.js не потрібен */
export function makeQR(el, text, size = 180) {
  if (!el) return;
  el.innerHTML = "";

  const data = String(text || "");
  const s = Math.max(96, Number(size) || 180);

  if (typeof window !== "undefined" && typeof window.QRCode === "function") {
    new window.QRCode(el, {
      text: data,
      width: s,
      height: s,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    return;
  }

  // fallback: png з сервісу
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(data)}`;

  const img = document.createElement("img");
  img.alt = "QR";
  img.width = s;
  img.height = s;
  img.loading = "lazy";
  img.decoding = "async";
  img.src = src;
  img.style.display = "block";

  el.appendChild(img);
}

export { Auth };
