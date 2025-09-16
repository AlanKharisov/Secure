import { Auth } from "./firebase.js";

/** Автовизначення API-бази: локально чи прод */
const PROD_BASE = "https://app.world-of-photo.com";
export const API =
    location.hostname === "app.world-of-photo.com" ? PROD_BASE : location.origin;

/** хелпери DOM */
export const qs  = (s, r=document) => r.querySelector(s);
export const qsa = (s, r=document) => [...r.querySelectorAll(s)];
export const h = (tag, attrs={}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})) {
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
    const token = await Auth.idToken().catch(()=> "");
    const email = (Auth.user?.email || "").trim().toLowerCase();

    const baseHeaders = { "Content-Type": "application/json" };
    if (email) baseHeaders["X-User"] = email;
    if (token) baseHeaders["Authorization"] = "Bearer " + token;

    const opts = { method, headers: { ...baseHeaders, ...headers } };
    if (body != null) opts.body = typeof body === "string" ? body : JSON.stringify(body);

    const res = await fetch(API + path, opts);
    const isJSON = (res.headers.get("Content-Type")||"").includes("application/json");
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        if (isJSON) { try { const e=await res.json(); if (e?.error) msg = e.error } catch {} }
        throw new Error(msg);
    }
    return isJSON ? res.json() : res.text();
}

/** flash */
export function flash(msg, ms=3000) {
    const box = qs("#flash");
    box.textContent = msg;
    box.style.display = "block";
    setTimeout(()=> box.style.display="none", ms);
}

export function makeQR(el, text, size = 148) {
  if (!el) return;

  // очистити контейнер перед рендером
  while (el.firstChild) el.removeChild(el.firstChild);

  // якщо з якоїсь причини бібліотека не підвантажилась — даємо посилання
  if (typeof window.QRCode !== 'function') {
    const a = document.createElement('a');
    a.href = String(text || '');
    a.textContent = String(text || '');
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    el.appendChild(a);
    console.warn('QRCode library is not loaded — rendered a link instead');
    return;
  }

  new window.QRCode(el, {
    text: String(text || ''),
    width: size,
    height: size,
    correctLevel: window.QRCode.CorrectLevel.M,
  });
}


/** збереження canvas як PNG */
export function downloadCanvasPng(canvas, filename="qr.png") {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
}

export { Auth };
