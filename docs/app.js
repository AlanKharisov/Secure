/* App JS */
"use strict";

const API = window.API_BASE || window.location.origin;

const $ = (s, sc=document) => sc.querySelector(s);
function authUser() { return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
function authHeaders() { const u = authUser(); return u ? { "X-User": u } : {}; }
function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function addQuery(url, params) {
  const u = new URL(url, window.location.origin);
  Object.entries(params || {}).forEach(([k,v])=>{
    if (v!==undefined && v!==null) u.searchParams.set(k, String(v));
  });
  return u.toString();
}

/* Tabs (кнопки мають мати id: adminTab, manufTab, userTab; панелі: #admin, #manufacturer, #user) */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const pane = $("#" + btn.dataset.tab);
    if (pane) pane.classList.add("active");

    const tab = btn.dataset.tab;
    if (tab === "manufacturer") loadManufacturerProducts();
    if (tab === "admin") loadAllProducts();
    if (tab === "user") renderMyOwnedFromCache();
  });
});

/* Ролі, що приходять з auth-ui.js */
let CURRENT_ROLES = { email:"", isAdmin:false, isManufacturer:false, brands:[] };
document.addEventListener("roles-ready", (e) => {
  CURRENT_ROLES = e.detail || CURRENT_ROLES;
  if (CURRENT_ROLES.isManufacturer) loadManufacturerProducts();
  renderMyOwnedFromCache();
  if (CURRENT_ROLES.isAdmin) loadAllProducts();
});

/* QR (блок “Створено”) */
let publicQR = null;
function getPublicQR() {
  const node = document.getElementById("publicQR");
  if (!node) return null;
  if (!publicQR) publicQR = new QRCode(node, { text: "", width: 180, height: 180 });
  return publicQR;
}

/* Manufacturer: create form */
const createForm = $("#createForm");
const createdBlock = $("#createdBlock");
let lastCreatedUrl = "";

createForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(createForm);
  const name = (fd.get("name") || "").toString().trim();
  const mfg  = (fd.get("mfg") || "").toString().trim();
  const image= (fd.get("image") || "").toString().trim();
  const edStr= (fd.get("edition") || "1").toString().trim();
  const edition = Math.max(1, parseInt(edStr, 10) || 1);

  if (!authUser()) { alert("Увійдіть"); return; }
  if (!CURRENT_ROLES.isManufacturer) { alert("Ви не виробник"); return; }
  if (!name) { alert("Назва обовʼязкова"); return; }

  const primaryBrand = (CURRENT_ROLES.brands && CURRENT_ROLES.brands[0]) ? CURRENT_ROLES.brands[0].slug : "";
  if (!primaryBrand) {
    alert("У вас немає бренду. Зверніться до адміна або створіть бренд.");
    return;
  }

  try {
    const body = { name, brand: primaryBrand };
    if (mfg) body.manufacturedAt = mfg;
    if (image) body.image = image;
    if (edition && edition > 1) body.edition = edition;

    const res = await fetch(`${API}/api/manufacturer/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const p = await res.json();
    if (!res.ok) throw new Error(p.error || "Create failed");

    const baseUrl = p.publicUrl || `${API}/details.html?id=${p.id}`;
    const url = addQuery(baseUrl, { s: p.serialHash || "" });
    lastCreatedUrl = url;

    createdBlock?.classList.remove("hidden");
    $("#createdId")?.textContent = p.id;
    $("#createdState")?.textContent = p.state;
    $("#createdUrl")?.textContent = url;

    const qr = getPublicQR();
    if (qr) { qr.clear(); qr.makeCode(url); }

    await loadManufacturerProducts();
    renderMyOwnedFromCache();
    createForm.reset();
  } catch (err) {
    alert(err.message);
  }
});

// Download QR
$("#downloadQR")?.addEventListener("click", () => {
  const node = document.querySelector("#publicQR canvas") || document.querySelector("#publicQR img");
  if (!node) { alert("QR ще не згенерований"); return; }
  let dataURL = "";
  if (node.tagName.toLowerCase() === "canvas") dataURL = node.toDataURL("image/png");
  else dataURL = node.src || "";
  if (!dataURL) { alert("Не вдалося отримати QR"); return; }

  const a = document.createElement("a");
  a.href = dataURL;
  a.download = "qr.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// Copy URL
$("#copyUrl")?.addEventListener("click", async () => {
  if (!lastCreatedUrl) return;
  try {
    await navigator.clipboard.writeText(lastCreatedUrl);
    alert("Посилання скопійовано");
  } catch {
    alert("Не вдалося скопіювати");
  }
});

/* Таблиці */
const manufBody = $("#productsBody");
const allBody   = $("#allBody");
const myBody    = $("#myBody");

let _lastProducts = [];

async function loadManufacturerProducts() {
  if (!manufBody) return;
  if (!authUser()) {
    manufBody.innerHTML = `<tr><td colspan="6" class="muted">Увійдіть</td></tr>`;
    return;
  }
  manufBody.innerHTML = `<tr><td colspan="6" class="muted">Завантаження…</td></tr>`;
  try {
    const res = await fetch(`${API}/api/products`, { headers: { ...authHeaders() } });
    const list = await res.json();
    _lastProducts = Array.isArray(list) ? list : [];

    if (!_lastProducts.length) {
      manufBody.innerHTML = `<tr><td colspan="6" class="muted">Ще немає продуктів</td></tr>`;
      renderMyOwnedFromCache();
      return;
    }

    manufBody.innerHTML = "";
    _lastProducts.forEach(p => {
      const detailsUrl = addQuery(`details.html?id=${encodeURIComponent(p.id)}`, { s: p.serialHash || "" });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.id}</td>
        <td>${esc(p.meta?.name || "")}</td>
        <td class="mono">${esc(p.meta?.serial || "")}</td>
        <td class="mono">${esc(p.meta?.edition || "1")}</td>
        <td><span class="badge">${esc(p.state)}</span></td>
        <td>
          <a class="btn" href="${detailsUrl}" target="_blank" rel="noopener">Деталі</a>
          ${p.state === "created" ? `<button class="btn" data-buy="${p.id}">Позначити купленим (передати мені)</button>` : ``}
        </td>
      `;
      manufBody.appendChild(tr);
    });

    manufBody.querySelectorAll("[data-buy]").forEach(btn => {
      btn.addEventListener("click", () => markPurchased(btn.getAttribute("data-buy")));
    });

    renderMyOwnedFromCache();
  } catch (e) {
    console.error("loadManufacturerProducts:", e);
    manufBody.innerHTML = `<tr><td colspan="6" class="muted">Помилка завантаження</td></tr>`;
  }
}

async function loadAllProducts() {
  if (!allBody) return;
  if (!authUser()) {
    allBody.innerHTML = `<tr><td colspan="7" class="muted">Увійдіть</td></tr>`;
    return;
  }
  allBody.innerHTML = `<tr><td colspan="7" class="muted">Завантаження…</td></tr>`;
  try {
    const res = await fetch(`${API}/api/products?all=1`, { headers: { ...authHeaders() } });
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) {
      allBody.innerHTML = `<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>`;
      return;
    }
    allBody.innerHTML = "";
    list.forEach(p => {
      const detailsUrl = addQuery(`details.html?id=${encodeURIComponent(p.id)}`, { s: p.serialHash || "" });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.id}</td>
        <td>${esc(p.meta?.name || "")}</td>
        <td class="mono">${esc(p.meta?.serial || "")}</td>
        <td class="mono">${esc(p.meta?.edition || "1")}</td>
        <td>${esc(p.meta?.brand || p.brand || "")}</td>
        <td><span class="badge">${esc(p.state)}</span></td>
        <td><a class="btn" href="${detailsUrl}" target="_blank" rel="noopener">Деталі</a></td>
      `;
      allBody.appendChild(tr);
    });
  } catch (e) {
    console.error("loadAllProducts:", e);
    allBody.innerHTML = `<tr><td colspan="7" class="muted">Помилка завантаження</td></tr>`;
  }
}

function renderMyOwnedFromCache() {
  if (!myBody) return;
  const me = authUser();
  if (!me) {
    myBody.innerHTML = `<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>`;
    return;
  }
  const mine = _lastProducts.filter(p => (p.owner || "").toLowerCase() === me.toLowerCase());
  myBody.innerHTML = "";
  if (!mine.length) {
    myBody.innerHTML = `<tr><td colspan="6" class="muted">Ще немає товарів</td></tr>`;
  } else {
    let pCnt=0, cCnt=0, clCnt=0;
    mine.forEach(pdt => {
      if (pdt.state === "purchased") pCnt++;
      else if (pdt.state === "created") cCnt++;
      else if (pdt.state === "claimed") clCnt++;
      const img = (pdt.meta?.image || "").trim() ? `<img class="thumb" src="${esc(pdt.meta.image)}" alt="">` : "";
      const detailsUrl = addQuery(`details.html?id=${encodeURIComponent(pdt.id)}`, { s: pdt.serialHash || "" });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${img}</td>
        <td>${esc(pdt.meta?.name || "-")}</td>
        <td class="mono">${esc(pdt.meta?.serial || "-")}</td>
        <td class="mono">${pdt.id}</td>
        <td><span class="badge">${esc(pdt.state)}</span></td>
        <td><a class="btn" href="${detailsUrl}" target="_blank" rel="noopener">Відкрити</a></td>
      `;
      myBody.appendChild(tr);
    });
    const kp = (id,v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    kp("kPurchased", pCnt);
    kp("kCreated", cCnt);
    kp("kClaimed", clCnt);
  }
}

async function markPurchased(id) {
  if (!authUser()) { alert("Будь ласка, увійдіть у свій акаунт."); return; }
  try {
    const r = await fetch(`${API}/api/products/${id}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: "{}"
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Failed");
    await loadManufacturerProducts();
    renderMyOwnedFromCache();
    alert("Власність передано вам");
  } catch (e) {
    alert(e.message);
  }
}

// Якщо користувач вже залогінений до завантаження
if (window.Auth && window.Auth.user) {
  renderMyOwnedFromCache();
}
