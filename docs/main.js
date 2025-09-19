// main.js
import { Auth, uploadFile } from "./firebase.js";

/* ---------- helpers ---------- */
const qs  = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];
const on  = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

function setView(view) {
  qsa("[data-view]").forEach(sec => {
    sec.style.display = sec.dataset.view === view ? "" : "none";
  });
  qsa("[data-nav]").forEach(a=>{
    a.classList.toggle("active", a.dataset.nav === view);
  });
}

async function api(path, { method="GET", body=null, headers={} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  const tok = await Auth.idToken();
  if (tok) h.Authorization = `Bearer ${tok}`;
  else if (Auth.user?.email) h["X-User"] = Auth.user.email; // дев-фолбек

  const res = await fetch(path, {
    method, headers: h, body: body ? JSON.stringify(body) : null,
    credentials: "same-origin",
  });

  if (res.status === 204) return null;

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) { try { data = await res.json(); } catch {} }
  else { data = await res.text(); }

  if (!res.ok) {
    const msg = data?.error || (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

/* ---------- renderers ---------- */

function renderProfile(me){
  const appStatus = me.companyApplicationStatus ?? null;
  const statusChip = appStatus
    ? `<span class="tag tag-${appStatus}">${appStatus}</span>`
    : `<span class="tag">—</span>`;

  const brands = (me.brands||[]).length
    ? `<ul>${me.brands.map(b=>`
        <li><b>${b.name}</b> <small>(${b.slug})</small> ${b.verified?'<span class="tag tag-approved">verified</span>':''}</li>
      `).join("")}</ul>`
    : "—";

  qs("#profileBox").innerHTML = `
    <h3>Мій профіль</h3>
    <p><b>Емейл:</b> ${me.email}</p>
    <p><b>Адмін:</b> ${me.isAdmin ? "так" : "ні"}</p>
    <p><b>Мої бренди:</b> ${brands}</p>
    <h4>Статус заявки</h4>
    <p>${statusChip}</p>
    ${!me.isManufacturer && !appStatus ? `
      <div class="muted">Ще немає компанії. Перейдіть на вкладку <b>Компанія</b>, щоб подати заявку.</div>` : ``}
  `;

  // Навігація: "Компанія" — завжди показуємо. "Адмін" — тільки адміну.
  const adminNav = qs('[data-nav="admin"]');
  if (adminNav) adminNav.style.display = me.isAdmin ? "" : "none";
}

/* simple lists */
function renderProductsList(list, el){
  if (!el) return;
  if (!Array.isArray(list) || !list.length) {
    el.innerHTML = `<div class="muted">Немає продуктів</div>`;
    return;
  }
  el.innerHTML = list.map(p => `
    <div class="card">
      <div class="row">
        <div class="col">
          <div><b>${p.meta?.name || "ITEM"}</b></div>
          <div>Token: ${p.tokenId}</div>
          <div>SKU: ${p.sku || "—"}</div>
          <div>Edition: ${p.editionNo || 1}/${p.editionTotal || 1}</div>
          <div>State: <span class="tag">${p.state}</span></div>
        </div>
        <div class="col right">
          ${p.publicUrl ? `<a class="btn" target="_blank" href="${p.publicUrl}">Деталі</a>` : ``}
        </div>
      </div>
    </div>
  `).join("");
}

function renderAdminApps(list){
  const wrap = qs("#adminApps"); if (!wrap) return;
  if (!Array.isArray(list) || !list.length) {
    wrap.innerHTML = `<div class="muted">Немає заявок</div>`; return;
  }
  wrap.innerHTML = list.map(a=>`
    <div class="card" data-app="${a.id}">
      <h4>${a.brandName || a.legalName}</h4>
      <p><b>Заявник:</b> ${a.fullName} &lt;${a.contactEmail || a.user}&gt;</p>
      <p><b>Країна:</b> ${a.country || "—"} | <b>VAT:</b> ${a.vat || "—"} | <b>Reg#:</b> ${a.regNumber || "—"}</p>
      <p><b>Сайт:</b> ${a.site || "—"} | <b>Тел:</b> ${a.phone || "—"}</p>
      <p><b>Адреса:</b> ${a.address || "—"}</p>
      <p><b>Доказ:</b> ${a.proofUrl ? `<a href="${a.proofUrl}" target="_blank">переглянути</a>` : "—"}</p>
      <div class="row">
        <button class="btn" data-approve="${a.id}">Approve</button>
        <button class="btn danger" data-reject="${a.id}">Reject</button>
      </div>
    </div>
  `).join("");
}

/* ---------- loaders ---------- */

async function loadProfile(){
  const me = await api("/api/me");
  renderProfile(me);

  // завжди вантажимо юзерські продукти
  try {
    const list = await api("/api/products");
    renderProductsList(list, qs("#myProducts"));
  } catch (e) {
    console.warn("my products:", e.message || e);
    renderProductsList([], qs("#myProducts"));
  }

  // якщо є доступ як виробник/бренд вже існує
  if (me.isManufacturer || me.companyApplicationStatus === "approved") {
    await Promise.all([loadBatches(), loadCompanyProducts()]);
  }

  if (me.isAdmin) await loadAdminPending();
}

async function loadBatches(){
  try {
    const list = await api("/api/manufacturer/batches");
    const el = qs("#myBatches");
    if (!el) return;
    if (!list.length) el.innerHTML = `<div class="muted">Партій ще немає</div>`;
    else el.innerHTML = list.map(b=>`<div class="card"><b>${b.title}</b> <small>#${b.id}</small></div>`).join("");

    const sel = qs("#companyProductForm select[name='batchId']");
    if (sel) {
      sel.innerHTML = `<option value="">— без партії —</option>` +
        list.map(b=>`<option value="${b.id}">${b.title}</option>`).join("");
    }
  } catch (e) {
    console.warn("batches:", e.message || e);
  }
}

async function loadCompanyProducts(){
  const sku = (qs("#manuSkuFilter")?.value || "").trim().toUpperCase();
  const url = sku ? `/api/manufacturer/products?sku=${encodeURIComponent(sku)}` : `/api/manufacturer/products`;
  try {
    const list = await api(url);
    renderProductsList(list, qs("#myProductsCompany"));
  } catch (e) {
    console.warn("company products:", e.message || e);
    renderProductsList([], qs("#myProductsCompany"));
  }
}

async function loadAdminPending(){
  try {
    const list = await api("/api/admins/company-applications?status=pending");
    renderAdminApps(list);
  } catch (e) {
    console.warn("admin pending:", e.message || e);
  }
}

/* ---------- wiring ---------- */

function wireNav(){
  on(qs('[data-nav="profile"]'), "click", (e)=>{e.preventDefault(); setView("profile");});
  on(qs('[data-nav="company"]'), "click", async (e)=>{
    e.preventDefault(); setView("company");
    // спробуємо оновити компанійські дані (якщо прав нема — тихо ігноруємо)
    await Promise.allSettled([loadBatches(), loadCompanyProducts()]);
  });
  on(qs('[data-nav="admin"]'), "click", async (e)=>{
    e.preventDefault(); setView("admin");
    await loadAdminPending();
  });
}

function wireAuthButtons(){
  // якщо у твоєму firebase.js вже є привʼязка — дубль не зашкодить.
  on(qs("#loginBtn"), "click", ()=> Auth.signIn());
  on(qs("#logoutBtn"), "click", ()=> Auth.signOut());
}

function wireCompanyApply(){
  on(qs("#proofFile"), "change", async (e)=>{
    const file = e.target.files?.[0];
    if (!file) return;
    if (!Auth.user) return alert("Увійдіть спочатку");

    try {
      const { url, path } = await uploadFile(file, "brand_proofs");
      qs('#companyForm [name="proofUrl"]').value = url;
      qs("#companyForm").dataset.proofPath = path;
      const m = qs("#applyMsg");
      if (m) m.innerHTML = `Файл завантажено: <a href="${url}" target="_blank">переглянути</a>`;
    } catch (err) {
      alert("Upload error: " + (err.message || err));
    }
  });

  on(qs("#companyForm"), "submit", async (e)=>{
    e.preventDefault();
    if (!Auth.user) return alert("Увійдіть спочатку");
    const f = e.target;
    const body = {
      fullName:     f.fullName?.value.trim(),
      contactEmail: f.contactEmail?.value.trim(),
      legalName:    f.legalName?.value.trim(),
      brandName:    f.brandName?.value.trim(),
      country:      f.country?.value.trim(),
      vat:          f.vat?.value.trim(),
      regNumber:    f.regNumber?.value.trim(),
      site:         f.site?.value.trim(),
      phone:        f.phone?.value.trim(),
      address:      f.address?.value.trim(),
      proofUrl:     f.proofUrl?.value.trim(),
      proofPath:    (qs("#companyForm").dataset.proofPath || ""),
    };
    if (!body.fullName || !body.contactEmail || !body.legalName) {
      return alert("Заповніть обовʼязкові поля: Імʼя, Email, Юр.назва");
    }
    try {
      await api("/api/company/apply", { method:"POST", body });
      f.reset(); delete qs("#companyForm").dataset.proofPath;
      const m = qs("#applyMsg"); if (m) m.textContent = "Заявку надіслано.";
      setView("profile");
      await loadProfile();
    } catch (err) {
      alert("Помилка подачі: " + (err.message || err));
    }
  });
}

function wireManufacturer(){
  on(qs("#batchForm"), "submit", async (e)=>{
    e.preventDefault();
    const title = e.target.title?.value.trim();
    if (!title) return alert("Вкажіть назву партії");
    try {
      await api("/api/manufacturer/batches", { method:"POST", body:{ title } });
      e.target.reset();
      await loadBatches();
    } catch (err) {
      alert("Помилка створення партії: " + (err.message || err));
    }
  });

  on(qs("#manuSkuBtn"), "click", async ()=> { await loadCompanyProducts(); });

  on(qs("#companyProductForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const body = {
      name:           f.name?.value.trim(),
      sku:            f.sku?.value.trim(),
      manufacturedAt: f.manufacturedAt?.value.trim(),
      image:          f.image?.value.trim(),
      editionCount:   parseInt(f.editionCount?.value || "1", 10) || 1,
      certificates:   (f.certificates?.value || "").split(",").map(s=>s.trim()).filter(Boolean),
      batchId:        f.batchId?.value.trim(),
    };
    if (!body.name) return alert("Назва обовʼязкова");
    try {
      await api("/api/manufacturer/products", { method:"POST", body });
      const m = qs("#companyCreateMsg"); if (m) m.textContent = "Створено.";
      f.reset();
      await loadCompanyProducts();
    } catch (err) {
      alert("Помилка створення товару: " + (err.message || err));
    }
  });

  on(qs("#userProductForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const body = {
      name:           f.name?.value.trim(),
      sku:            f.sku?.value.trim(),
      manufacturedAt: f.manufacturedAt?.value.trim(),
      image:          f.image?.value.trim(),
      editionCount:   parseInt(f.editionCount?.value || "1", 10) || 1,
      certificates:   (f.certificates?.value || "").split(",").map(s=>s.trim()).filter(Boolean),
    };
    if (!body.name) return alert("Назва обовʼязкова");
    try {
      await api("/api/user/products", { method:"POST", body });
      const m = qs("#userCreateMsg"); if (m) m.textContent = "Створено.";
      f.reset();
      await loadProfile();
      setView("profile");
    } catch (err) {
      alert("Помилка створення товару: " + (err.message || err));
    }
  });
}

function wireAdmin(){
  const wrap = qs("#adminApps"); if (!wrap) return;
  on(wrap, "click", async (e)=>{
    const b = e.target.closest("button"); if (!b) return;

    if (b.dataset.approve){
      const id = b.dataset.approve;
      try {
        await api(`/api/admins/company-applications/${id}/approve`, { method:"POST" });
        await Promise.all([loadAdminPending(), loadProfile()]);
      } catch (err) {
        alert("Approve error: " + (err.message || err));
      }
    }
    if (b.dataset.reject){
      const id = b.dataset.reject;
      const reason = prompt("Причина відмови:") || "";
      try {
        await api(`/api/admins/company-applications/${id}/reject`, { method:"POST", body:{ reason } });
        await Promise.all([loadAdminPending(), loadProfile()]);
      } catch (err) {
        alert("Reject error: " + (err.message || err));
      }
    }
  });
}

/* ---------- auth lifecycle ---------- */
async function setupAuth(){
  setView("profile");
  wireAuthButtons();

  Auth.onChange(async (user)=>{
    // перемикаємо кнопки
    const loginBtn  = qs("#loginBtn");
    const logoutBtn = qs("#logoutBtn");
    if (loginBtn)  loginBtn.style.display  = user ? "none" : "";
    if (logoutBtn) logoutBtn.style.display = user ? "" : "none";

    if (!user){
      // чистимо вміст
      ["#profileBox","#myProducts","#myProductsCompany","#myBatches","#adminApps","#applyMsg","#companyCreateMsg","#userCreateMsg"]
        .forEach(sel => { const el = qs(sel); if (el) el.innerHTML = ""; });
      // показуємо вкладки: Компанія — є; Адмін — приховано
      const adminNav = qs('[data-nav="admin"]'); if (adminNav) adminNav.style.display="none";
      setView("profile");
      return;
    }

    try { await loadProfile(); }
    catch(e){ console.error("loadProfile:", e.message || e); }
  });
}

/* ---------- init ---------- */
(function init(){
  wireNav();
  wireCompanyApply();
  wireManufacturer();
  wireAdmin();
  setupAuth();
})();
