// docs/main.js (ES module)
import { Auth, uploadFile } from "./firebase.js";

/* ---------- helpers ---------- */
const qs  = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];
const on  = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

function setView(view) {
  // Очікуємо секції з data-view="profile|manufacturer|admin"
  qsa("[data-view]").forEach(sec => {
    sec.style.display = sec.dataset.view === view ? "" : "none";
  });
  // підсвітка навігації (опційно)
  qsa("[data-nav]").forEach(a=>{
    a.classList.toggle("active", a.dataset.nav === view);
  });
}

async function api(path, { method="GET", body=null, headers={} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  const token = await Auth.idToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (Auth.user?.email) h["X-User"] = Auth.user.email; // fallback для деву

  const res = await fetch(path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : null,
    credentials: "same-origin",
  });

  // 204 OK без тіла
  if (res.status === 204) return null;

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch (_) {}
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const msg = data?.error || (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

/* ---------- UI рендери ---------- */

function renderProfileBox(me) {
  const box = qs("#profileBox");
  if (!box) return;

  const appStatus = me.companyApplicationStatus ?? null;
  const statusBadge = appStatus
    ? `<span class="tag tag-${appStatus}">${appStatus}</span>`
    : `<span class="tag">no application</span>`;

  const brands = (me.brands || []).map(b => `
    <li>
      <strong>${b.name}</strong>
      <small>(${b.slug})</small>
      ${b.verified ? ` <span class="tag tag-approved">verified</span>` : ``}
    </li>`).join("") || `<em>—</em>`;

  box.innerHTML = `
    <div class="card">
      <h3>Профіль</h3>
      <p><b>Email:</b> ${me.email}</p>
      <p><b>Ролі:</b>
        ${me.isAdmin ? `<span class="tag">admin</span>` : ``}
        ${me.isManufacturer ? `<span class="tag">manufacturer</span>` : `<span class="tag">user</span>`}
      </p>
      <p><b>Статус заявки:</b> ${statusBadge}</p>
      <p><b>Бренди:</b></p>
      <ul>${brands}</ul>
    </div>
  `;

  // навігацію вмикаємо/ховаємо
  const adminNav = qs('[data-nav="admin"]');
  if (adminNav) adminNav.style.display = me.isAdmin ? "" : "none";

  const manufNav = qs('[data-nav="manufacturer"]');
  if (manufNav) manufNav.style.display = (me.isManufacturer || appStatus === "approved") ? "" : "none";
}

function renderProductsList(list, el) {
  if (!el) return;
  if (!Array.isArray(list) || list.length === 0) {
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
          ${p.publicUrl ? `<a class="btn" href="${p.publicUrl}" target="_blank">Деталі</a>` : ``}
        </div>
      </div>
    </div>
  `).join("");
}

function renderAdminApps(list) {
  const wrap = qs("#adminApps");
  if (!wrap) return;
  if (!Array.isArray(list) || list.length === 0) {
    wrap.innerHTML = `<div class="muted">Немає заявок</div>`;
    return;
  }
  wrap.innerHTML = list.map(a => `
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

async function loadProfile() {
  const me = await api("/api/me");
  renderProfileBox(me);

  // завжди вантажимо мої (користувацькі) продукти
  await loadMyProducts();

  // якщо він виробник або вже approved — показуємо вкладку виробника та дані
  if (me.isManufacturer || me.companyApplicationStatus === "approved") {
    await loadManufacturerBatches();
    await loadManufacturerProducts();
  }

  // якщо адмін – підгружаємо заявки
  if (me.isAdmin) {
    await loadAdminPending();
  }

  // якщо нічого не вибрано — відкриваємо профіль
  setView("profile");
}

async function loadMyProducts() {
  const list = await api("/api/products");
  renderProductsList(list, qs("#myProducts"));
}

async function loadManufacturerProducts() {
  const sku = (qs("#manuSkuFilter")?.value || "").trim().toUpperCase();
  const url = sku ? `/api/manufacturer/products?sku=${encodeURIComponent(sku)}` : `/api/manufacturer/products`;
  try {
    const list = await api(url);
    renderProductsList(list, qs("#myProductsCompany"));
  } catch (e) {
    // якщо 401 — просто нічого не показуємо (користувач не виробник)
    console.warn("company products:", e.message || e);
    const el = qs("#myProductsCompany");
    if (el) el.innerHTML = `<div class="muted">Недоступно</div>`;
  }
}

async function loadManufacturerBatches() {
  try {
    const list = await api("/api/manufacturer/batches");
    const el = qs("#myBatches");
    if (!el) return;
    if (!Array.isArray(list) || list.length === 0) {
      el.innerHTML = `<div class="muted">Партій ще немає</div>`;
      return;
    }
    el.innerHTML = list.map(b => `
      <div class="card"><b>${b.title}</b> <small>#${b.id}</small></div>
    `).join("");
    // заповнимо селект batchId якщо є
    const sel = qs("#companyProductForm select[name='batchId']");
    if (sel) {
      sel.innerHTML = `<option value="">— без партії —</option>` +
        list.map(b => `<option value="${b.id}">${b.title}</option>`).join("");
    }
  } catch (e) {
    console.warn("batches:", e.message || e);
    const el = qs("#myBatches");
    if (el) el.innerHTML = `<div class="muted">Недоступно</div>`;
  }
}

async function loadAdminPending() {
  try {
    const list = await api("/api/admins/company-applications?status=pending");
    renderAdminApps(list);
  } catch (e) {
    console.warn("admin apps:", e.message || e);
    const el = qs("#adminApps");
    if (el) el.innerHTML = `<div class="muted">Адмін дані недоступні</div>`;
  }
}

/* ---------- event wiring ---------- */

function wireNav() {
  on(qs('[data-nav="profile"]'), "click", (e)=>{ e.preventDefault(); setView("profile"); });
  on(qs('[data-nav="manufacturer"]'), "click", async (e)=>{
    e.preventDefault(); setView("manufacturer");
    // підстрахуємося — підвантажимо свіже
    await loadManufacturerBatches();
    await loadManufacturerProducts();
  });
  on(qs('[data-nav="admin"]'), "click", async (e)=>{
    e.preventDefault(); setView("admin");
    await loadAdminPending();
  });
}

function wireCompanyApplication() {
  // аплоад доказу
  on(qs("#proofFile"), "change", async (e)=>{
    const file = e.target.files?.[0];
    if (!file) return;
    if (!Auth.user) { alert("Спочатку увійдіть"); return; }
    try {
      const { url, path } = await uploadFile(file, "brand_proofs");
      const input = qs('#companyForm [name="proofUrl"]');
      if (input) input.value = url;
      qs("#companyForm").dataset.proofPath = path;
      const msg = qs("#applyMsg");
      if (msg) msg.innerHTML = `Файл завантажено: <a class="btn" href="${url}" target="_blank">переглянути</a>`;
    } catch (err) {
      alert("Upload error: " + (err.message || err));
    }
  });

  // сабміт заявки
  on(qs("#companyForm"), "submit", async (e)=>{
    e.preventDefault();
    if (!Auth.user) { alert("Увійдіть у акаунт"); return; }
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
      alert("Заповніть обовʼязкові поля (Імʼя, Email, Юр.назва)");
      return;
    }
    try {
      await api("/api/company/apply", { method:"POST", body });
      const msg = qs("#applyMsg");
      if (msg) msg.textContent = "Заявку надіслано. Очікуйте модерації.";
      f.reset();
      delete qs("#companyForm")?.dataset.proofPath;
      await loadProfile();
      setView("profile");
    } catch (err) {
      alert("Помилка подачі: " + (err.message || err));
    }
  });
}

function wireManufacturer() {
  // створення партії
  on(qs("#batchForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const title = f.title?.value.trim();
    if (!title) { alert("Вкажіть назву партії"); return; }
    try {
      await api("/api/manufacturer/batches", { method:"POST", body:{ title } });
      f.reset();
      await loadManufacturerBatches();
    } catch (err) {
      alert("Помилка створення партії: " + (err.message || err));
    }
  });

  // фільтр SKU
  on(qs("#manuSkuBtn"), "click", async ()=>{
    await loadManufacturerProducts();
  });

  // створення товарів (компанія)
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
    if (!body.name) { alert("Вкажіть назву товару"); return; }
    try {
      const created = await api("/api/manufacturer/products", { method:"POST", body });
      const msg = qs("#companyCreateMsg");
      if (msg) msg.textContent = `Створено: ${Array.isArray(created) ? created.length : 1}`;
      await loadManufacturerProducts();
      f.reset();
    } catch (err) {
      alert("Помилка створення товару: " + (err.message || err));
    }
  });

  // створення товарів (звичайний користувач) — якщо форма присутня
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
    if (!body.name) { alert("Вкажіть назву товару"); return; }
    try {
      const created = await api("/api/user/products", { method:"POST", body });
      const msg = qs("#userCreateMsg");
      if (msg) msg.textContent = `Створено: ${Array.isArray(created) ? created.length : 1}`;
      await loadMyProducts();
      f.reset();
      setView("profile");
    } catch (err) {
      alert("Помилка створення товару: " + (err.message || err));
    }
  });
}

function wireAdmin() {
  const wrap = qs("#adminApps");
  if (!wrap) return;

  on(wrap, "click", async (e)=>{
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.approve) {
      const id = btn.dataset.approve;
      try {
        await api(`/api/admins/company-applications/${id}/approve`, { method:"POST" });
        // Після approve — перелік оновити і профіль перезавантажити (бренд створиться/верифікується)
        await loadAdminPending();
        await loadProfile();
      } catch (err) {
        alert("Approve error: " + (err.message || err));
      }
    }

    if (btn.dataset.reject) {
      const id = btn.dataset.reject;
      const reason = prompt("Причина відмови:");
      try {
        await api(`/api/admins/company-applications/${id}/reject`, { method:"POST", body:{ reason: reason || "" } });
        await loadAdminPending();
        await loadProfile();
      } catch (err) {
        alert("Reject error: " + (err.message || err));
      }
    }
  });
}

/* ---------- auth ---------- */
async function setupAuth() {
  // Проста навігація видів для неавторизованого стану
  setView("profile");

  Auth.onChange(async (user) => {
    const loginBtn  = qs("#loginBtn");
    const logoutBtn = qs("#logoutBtn");
    if (loginBtn)  loginBtn.style.display  = user ? "none" : "";
    if (logoutBtn) logoutBtn.style.display = user ? "" : "none";

    if (!user) {
      // очищаємо UI
      const clearTargets = ["#profileBox", "#myProducts", "#myProductsCompany", "#myBatches", "#adminApps", "#applyMsg", "#companyCreateMsg", "#userCreateMsg"];
      clearTargets.forEach(sel => { const el = qs(sel); if (el) el.innerHTML = ""; });
      setView("profile");
      return; // взагалі нічого не вантажимо
    }

    // Авторизований — вантажимо профіль і решту
    try {
      await loadProfile();
    } catch (e) {
      console.error("loadProfile:", e.message || e);
    }
  });
}

/* ---------- init ---------- */
function wireStaticUI() {
  wireNav();
  wireCompanyApplication();
  wireManufacturer();
  wireAdmin();
}

(async function init(){
  wireStaticUI();
  await setupAuth();
})();
