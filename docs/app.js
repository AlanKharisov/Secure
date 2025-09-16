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

/** QR helper (без локальної qrcode.min.js) */
export function makeQR(el, text, size = 180) {
  if (!el) return;
  el.innerHTML = "";

  const data = String(text || "");
  const s = Math.max(96, Number(size) || 180);

  // Якщо раптом глобальна бібліотека є — використай її
  if (typeof window !== "undefined" && typeof window.QRCode === "function") {
    new window.QRCode(el, {
      text: data,
      width: s,
      height: s,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    return;
  }

  // Fallback: PNG з публічного сервісу
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(data)}`;

  const img = document.createElement("img");
  img.alt = "QR";
  img.width = s;
  img.height = s;
  img.loading = "lazy";
  img.decoding = "async";
  img.src = src;
  img.style.display = "block";

  // Посилання для відкриття в новій вкладці (звідти можна зберегти)
  const open = document.createElement("a");
  open.href = src;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Відкрити QR у новій вкладці";
  open.className = "btn mt";

  // Спроба зробити «Завантажити» (може не спрацювати, якщо CORS блочить)
  const save = document.createElement("button");
  save.className = "btn mt";
  save.textContent = "Завантажити QR (PNG)";
  save.addEventListener("click", async () => {
    try {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = src;
      await new Promise((res, rej) => {
        image.onload = res; image.onerror = rej;
      });
      const canvas = document.createElement("canvas");
      canvas.width = s; canvas.height = s;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, s, s);
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "qr.png";
      a.click();
    } catch {
      // якщо не вийшло — відкриємо у вкладці
      open.click();
    }
  });

  el.appendChild(img);
  el.appendChild(open);
  el.appendChild(save);
}

/** збереження canvas як PNG */
export function downloadCanvasPng(canvas, filename="qr.png") {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
}

export { Auth };
