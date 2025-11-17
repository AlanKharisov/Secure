// main.js — MARKI Secure dashboard SPA
// Працює з:
//   /firebase.js → export { Auth, uploadFile, ensureLoggedIn }
//   /app.js      → export { api, qs, qsa }

import { Auth, uploadFile, ensureLoggedIn } from "/js/firebase.js";
import { api, qs, qsa } from "/js/app.js";

/* ==========================================================
 * 1. УТИЛІТИ
 * ========================================================*/

const STORAGE_KEYS = {
  events: "ms_events",        // події аналітики
  theme:  "ms_theme"          // "light" | "dark"
};

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function trackEvent(type, payload = {}) {
  const events = loadJSON(STORAGE_KEYS.events, []);
  events.push({ type, ts: Date.now(), ...payload });
  // обрізаємо до 5000 останніх
  if (events.length > 5000) events.splice(0, events.length - 5000);
  saveJSON(STORAGE_KEYS.events, events);
}

function filterEventsByRange(range = "year") {
  // range: "day" | "month" | "year" | "all"
  const events = loadJSON(STORAGE_KEYS.events, []);
  if (range === "all") return events;

  const now = new Date();
  return events.filter(ev => {
    const d = new Date(ev.ts);
    if (range === "day") {
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }
    if (range === "month") {
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth()
      );
    }
    if (range === "year") {
      return d.getFullYear() === now.getFullYear();
    }
    return true;
  });
}

function groupEventsByMonth(events) {
  // повертає масив із 12 елементів — скільки подій на кожен місяць
  const arr = Array(12).fill(0);
  events.forEach(ev => {
    const d = new Date(ev.ts);
    const m = d.getMonth();
    arr[m] += 1;
  });
  return arr;
}

function statusChip(status) {
  if (!status) return `<span class="tag">—</span>`;
  const s = String(status).toLowerCase();
  const cls =
    s === "approved" ? "tag-approved" :
    s === "rejected" ? "tag-rejected" :
    "tag-pending";
  return `<span class="tag ${cls}">${s}</span>`;
}

/* ==========================================================
 * 2. ТЕМА + САЙДБАР
 * ========================================================*/

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = t;
  saveJSON(STORAGE_KEYS.theme, t);
}

function initTheme() {
  const stored = loadJSON(STORAGE_KEYS.theme, "light");
  applyTheme(stored);

  const toggleTop = qs("#themeToggle");
  const toggleSettings = qs("#settingsThemeToggle");

  const handler = () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  };

  toggleTop?.addEventListener("click", handler);
  toggleSettings?.addEventListener("click", handler);
}

function initSidebar() {
  const toggleBtn = qs("#sidebarToggle");
  const overlay = qs(".sidebar-overlay");

  const closeSidebar = () => document.body.classList.remove("sidebar-open");
  const openSidebar  = () => document.body.classList.add("sidebar-open");

  toggleBtn?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  overlay?.addEventListener("click", closeSidebar);

  // простий свайп на мобілці
  let startX = null;
  document.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
  });
  document.addEventListener("touchend", (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (startX < 40 && dx > 60) openSidebar();
    if (dx < -60) closeSidebar();
    startX = null;
  });
}

/* ==========================================================
 * 3. НАВІГАЦІЯ МІЖ В’ЮХАМИ
 * ========================================================*/

let currentView = "overview";
let lastMe = null;
let lastUser = null;

function setView(name) {
  currentView = name;
  qsa("[data-view]").forEach(sec => {
    sec.style.display = sec.dataset.view === name ? "" : "none";
  });
  qsa("[data-nav]").forEach(link => {
    link.classList.toggle("active", link.dataset.nav === name);
  });
  // закриваємо сайдбар на мобілі
  document.body.classList.remove("sidebar-open");

  // lazy load даних під конкретні вʼюхи
  if (!lastMe) return;
  if (name === "overview") {
    renderOverview(lastMe);
  } else if (name === "profile") {
    renderProfile(lastMe, lastUser);
  } else if (name === "company") {
    // компанія: форма заявки + компанійські продукти/партії
    loadCompanyView();
  } else if (name === "batches") {
    loadBatchesAndProducts();
  } else if (name === "messages") {
    loadMessagesView(lastMe);
  } else if (name === "settings") {
    renderSettings(lastMe, lastUser);
  } else if (name === "products") {
    loadUserProducts();
  }
}

function initNav() {
  qsa("[data-nav]").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setView(link.dataset.nav);
    });
  });
}

/* ==========================================================
 * 4. РЕНДЕР ХЕДЕРА (Hello + правий юзер)
 * ========================================================*/

function renderTopbar(me, user) {
  const name = (user?.displayName || me?.email || "").split(" ")[0] || "there";
  const fullName = user?.displayName || me?.email || "";
  const email = me?.email || user?.email || "";
  const photo = user?.photoURL || "";

  const helloEl = qs("#topGreeting");
  const nameEl  = qs("#topUserName");
  const mailEl  = qs("#topUserEmail");
  const avatar  = qs("#topUserAvatar");

  if (helloEl) helloEl.textContent = `Hello, ${name}!`;
  if (nameEl)  nameEl.textContent  = fullName;
  if (mailEl)  mailEl.textContent  = email;

  if (avatar) {
    if (photo) {
      avatar.style.backgroundImage = `url("${photo}")`;
      avatar.textContent = "";
    } else {
      avatar.style.backgroundImage = "";
      avatar.textContent = (email || "?")[0].toUpperCase();
    }
  }
}

/* ==========================================================
 * 5. ПРОФІЛЬ
 * ========================================================*/

function renderProfile(me, user) {
  const box = qs("#profileCard");
  if (!box) return;

  const fullName = user?.displayName || me.email;
  const email = me.email;
  const photo = user?.photoURL || "";
  const adminBadge = me.isAdmin
    ? `<span class="pill pill-admin">Admin</span>`
    : `<span class="pill pill-user">User</span>`;

  const brands = me.brands || [];
  const brandsHtml = brands.length
    ? brands.map(b => `
      <div class="brand-pill">
        <div class="brand-pill-main">
          <span class="brand-name">${b.name}</span>
          <span class="brand-slug">${b.slug}</span>
        </div>
        ${b.verified
          ? `<span class="tag tag-approved">verified</span>`
          : `<span class="tag tag-pending">pending</span>`}
      </div>
    `).join("")
    : `<div class="muted">Поки немає брендів</div>`;

  box.innerHTML = `
    <div class="profile-header">
      <div class="avatar-circle profile-avatar"
           style="${photo ? `background-image:url('${photo}')` : ""}">
        ${photo ? "" : (email || "?")[0].toUpperCase()}
      </div>
      <div>
        <div class="profile-name-row">
          <h2>${fullName}</h2>
          ${adminBadge}
        </div>
        <div class="muted">${email}</div>
      </div>
    </div>

    <div class="profile-grid">
      <div>
        <h4>Бренди</h4>
        <div class="profile-brands">
          ${brandsHtml}
        </div>
      </div>
      <div>
        <h4>Статус компанії</h4>
        <p>${statusChip(me.companyApplicationStatus)}</p>
        ${!me.isManufacturer && !me.companyApplicationStatus ? `
          <p class="muted small">
            Ще немає компанії. Перейдіть на вкладку <b>Компанія</b>, щоб подати заявку.
          </p>` : ""}
      </div>
    </div>
  `;
}

/* ==========================================================
 * 6. BUSINESS OVERVIEW (тільки адмін)
 * ========================================================*/

function renderOverview(me) {
  const section = qs('[data-view="overview"]');
  if (!section) return;

  const cardsWrap = qs("#overviewStats");
  const chartWrap = qs("#overviewChart");
  const rangeSelect = qs("#overviewRange");

  // Показуємо секцію тільки адміну
  if (!me.isAdmin) {
    section.style.display = "none";
    const navOverview = qs('[data-nav="overview"]');
    if (navOverview) navOverview.style.display = "none";
    return;
  }

  section.style.display = "";
  const navOverview = qs('[data-nav="overview"]');
  if (navOverview) navOverview.style.display = "";

  const range = rangeSelect?.value || "year";
  const events = filterEventsByRange(range);

  const uniqueUsers = new Set(events.filter(e => e.email).map(e => e.email.toLowerCase()));
  const totalProducts = events.filter(e => e.type === "create_user_product" || e.type === "create_company_product").length;
  const totalApplications = events.filter(e => e.type === "company_apply").length;
  const loginEvents = events.filter(e => e.type === "login");
  const lastLogin = loginEvents.length
    ? new Date(loginEvents[loginEvents.length - 1].ts).toLocaleString()
    : "—";

  if (cardsWrap) {
    cardsWrap.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Users</div>
        <div class="stat-value">${uniqueUsers.size}</div>
        <div class="stat-sub muted">за обраний період</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Products Created</div>
        <div class="stat-value">${totalProducts}</div>
        <div class="stat-sub muted">усі юзерські + брендові</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Brand Applications</div>
        <div class="stat-value">${totalApplications}</div>
        <div class="stat-sub muted">подано заявок</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last Login</div>
        <div class="stat-value small">${lastLogin}</div>
        <div class="stat-sub muted">по цій адмін-сесії</div>
      </div>
    `;
  }

  if (chartWrap) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const counts = groupEventsByMonth(events);
    const max = Math.max(...counts, 1);

    chartWrap.innerHTML = `
      <div class="chart-header">
        <div class="chart-title">Activity Overview</div>
      </div>
      <div class="chart-bars">
        ${counts.map((val, i) => {
          const h = (val / max) * 100;
          return `
            <div class="chart-bar">
              <div class="chart-bar-inner" style="height:${h || 4}%">
                ${val ? `<span class="chart-bar-value">${val}</span>` : ""}
              </div>
              <div class="chart-bar-label">${months[i]}</div>
            </div>`;
        }).join("")}
      </div>
    `;
  }

  if (rangeSelect && !rangeSelect.dataset._wired) {
    rangeSelect.addEventListener("change", () => renderOverview(me));
    rangeSelect.dataset._wired = "1";
  }
}

/* ==========================================================
 * 7. ПРОДУКТИ (юзерські)
 * ========================================================*/

function renderProductsList(list, el) {
  if (!el) return;
  if (!Array.isArray(list) || !list.length) {
    el.innerHTML = `<div class="muted">Немає продуктів</div>`;
    return;
  }
  el.innerHTML = list.map(p => `
    <div class="card product-card">
      <div class="product-main">
        <div class="product-title-row">
          <div class="product-name">${p.meta?.name || "ITEM"}</div>
          <span class="tag">${p.state}</span>
        </div>
        <div class="product-meta-row">
          <span>Token: ${p.tokenId}</span>
          <span>SKU: ${p.sku || "—"}</span>
          <span>Edition: ${p.editionNo || 1}/${p.editionTotal || 1}</span>
        </div>
      </div>
      <div class="product-actions">
        ${p.publicUrl
          ? `<a class="btn ghost" target="_blank" href="${p.publicUrl}">Деталі</a>`
          : ""}
      </div>
    </div>
  `).join("");
}

async function loadUserProducts() {
  const wrap = qs("#myProducts");
  if (!wrap) return;
  try {
    const list = await api("/api/products");
    renderProductsList(list, wrap);
  } catch (e) {
    console.warn("my products:", e.message || e);
    renderProductsList([], wrap);
  }
}

/* ==========================================================
 * 8. ПАРТІЇ + ТОВАРИ БРЕНДУ
 * ========================================================*/

async function loadBatchesAndProducts() {
  const batchesWrap = qs("#batchesList");
  const searchInput = qs("#batchSearch");
  if (!batchesWrap) return;

  let batches = [];
  let products = [];

  try {
    batches = await api("/api/manufacturer/batches");
  } catch (e) {
    console.warn("batches:", e.message || e);
  }
  try {
    products = await api("/api/manufacturer/products");
  } catch (e) {
    console.warn("company products:", e.message || e);
  }

  const byBatch = new Map();
  products.forEach(p => {
    const key = p.batchId || "_no_batch";
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(p);
  });

  function render(filterText = "") {
    const f = filterText.trim().toLowerCase();
    const list = batches.filter(b =>
      !f ||
      b.title.toLowerCase().includes(f) ||
      b.id.toLowerCase().includes(f)
    );

    batchesWrap.innerHTML = list.map(b => {
      const ps = byBatch.get(b.id) || [];
      const count = ps.length;
      return `
        <div class="card batch-card" data-batch="${b.id}">
          <div class="batch-header-row">
            <div>
              <div class="batch-title">${b.title}</div>
              <div class="batch-sub muted">#${b.id} • ${count} товар(ів)</div>
            </div>
            <button class="btn ghost" data-toggle-batch="${b.id}">Відкрити</button>
          </div>
          <div class="batch-details" data-details="${b.id}" style="display:none">
            <div class="batch-products">
              ${count ? ps.map(p => `
                <div class="batch-product-row">
                  <div>
                    <div class="product-name small">${p.meta?.name || "ITEM"}</div>
                    <div class="muted tiny">SKU: ${p.sku || "—"} • Token: ${p.tokenId}</div>
                  </div>
                  ${p.publicUrl ? `<a class="btn tiny" target="_blank" href="${p.publicUrl}">QR / Det</a>` : ""}
                </div>
              `).join("") : `<div class="muted tiny">Ще немає товарів у цій партії</div>`}
            </div>
          </div>
        </div>
      `;
    }).join("");

    // навішуємо відкривання
    qsa("[data-toggle-batch]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.toggleBatch;
        const pane = qs(`[data-details="${id}"]`);
        if (!pane) return;
        const open = pane.style.display !== "none";
        pane.style.display = open ? "none" : "";
        btn.textContent = open ? "Відкрити" : "Закрити";
      });
    });
  }

  render("");

  if (searchInput && !searchInput.dataset._wired) {
    searchInput.addEventListener("input", () => render(searchInput.value));
    searchInput.dataset._wired = "1";
  }
}

/* ==========================================================
 * 9. КОМПАНІЯ (форма заявки + створення товарів бренду)
 * ========================================================*/

async function loadBatchesSelect() {
  try {
    const list = await api("/api/manufacturer/batches");
    const sel = qs("#companyProductForm select[name='batchId']");
    const batchesWrap = qs("#myBatches");

    if (batchesWrap) {
      if (!list.length) {
        batchesWrap.innerHTML = `<div class="muted">Партій ще немає</div>`;
      } else {
        batchesWrap.innerHTML = list.map(b => `
          <div class="card tiny">
            <b>${b.title}</b> <span class="muted">#${b.id}</span>
          </div>
        `).join("");
      }
    }

    if (sel) {
      sel.innerHTML = `<option value="">— без партії —</option>` +
        list.map(b => `<option value="${b.id}">${b.title}</option>`).join("");
    }
  } catch (e) {
    console.warn("batches select:", e.message || e);
  }
}

async function loadCompanyProductsFiltered() {
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

async function loadCompanyView() {
  await Promise.allSettled([loadBatchesSelect(), loadCompanyProductsFiltered()]);
}

/* ==========================================================
 * 10. МЕСЕДЖІ (заявки на бренди)
 * ========================================================*/

function renderMessagesAdmin(list) {
  const wrap = qs("#messagesList");
  if (!wrap) return;
  if (!Array.isArray(list) || !list.length) {
    wrap.innerHTML = `<div class="muted">Заявок поки немає.</div>`;
    return;
  }
  wrap.innerHTML = list.map(a => `
    <div class="card message-card" data-app="${a.id}">
      <div class="message-main">
        <div class="message-title-row">
          <div class="message-title">${a.brandName || a.legalName}</div>
          <span class="tag tag-${a.status}">${a.status}</span>
        </div>
        <div class="message-meta tiny muted">
          ${a.fullName} &lt;${a.contactEmail || a.user}&gt; • ${a.country || "—"}
        </div>
        <div class="message-body tiny">
          VAT: ${a.vat || "—"} • Reg#: ${a.regNumber || "—"} • Site: ${a.site || "—"}
        </div>
        <div class="tiny">
          Доказ: ${a.proofUrl ? `<a href="${a.proofUrl}" target="_blank">переглянути</a>` : "—"}
        </div>
      </div>
      <div class="message-actions">
        <button class="btn tiny" data-approve="${a.id}">Approve</button>
        <button class="btn tiny danger" data-reject="${a.id}">Reject</button>
      </div>
    </div>
  `).join("");

  if (!wrap.dataset._wired) {
    wrap.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.approve) {
        const id = b.dataset.approve;
        try {
          await api(`/api/admins/company-applications/${id}/approve`, { method: "POST" });
          await loadMessagesView(lastMe);
          await reloadProfile();
        } catch (err) {
          alert("Approve error: " + (err.message || err));
        }
      }
      if (b.dataset.reject) {
        const id = b.dataset.reject;
        const reason = prompt("Причина відмови:") || "";
        try {
          await api(`/api/admins/company-applications/${id}/reject`, {
            method: "POST",
            body: { reason }
          });
          await loadMessagesView(lastMe);
          await reloadProfile();
        } catch (err) {
          alert("Reject error: " + (err.message || err));
        }
      }
    });
    wrap.dataset._wired = "1";
  }
}

async function loadMessagesView(me) {
  const wrap = qs("#messagesList");
  const info = qs("#messagesInfo");
  if (!wrap) return;

  if (!me.isAdmin) {
    // для звичайного юзера — просто інфа
    wrap.innerHTML = `<div class="muted small">
      Тут адміністратори бачать заявки на бренди.  
      Подати свою заявку можна у вкладці <b>Компанія</b>.
    </div>`;
    if (info) info.textContent = "Brand applications";
    return;
  }

  try {
    const list = await api("/api/admins/company-applications?status=pending");
    if (info) info.textContent = "Pending brand applications";
    renderMessagesAdmin(list);
  } catch (e) {
    wrap.textContent = e.message || "Помилка завантаження заявок";
  }
}

/* ==========================================================
 * 11. SETTINGS
 * ========================================================*/

function renderSettings(me, user) {
  const box = qs("#settingsInfo");
  if (!box) return;
  box.innerHTML = `
    <div class="card flat">
      <h4>Акаунт</h4>
      <p><b>Email:</b> ${me.email}</p>
      <p><b>Імʼя з Google:</b> ${user?.displayName || "—"}</p>
      <p class="muted small">
        Щоб змінити імʼя або аватар, змініть їх у Google-акаунті,  
        потім перелогіньтесь у MARKI Secure.
      </p>
    </div>
    <div class="card flat">
      <h4>Тема</h4>
      <p class="muted small">Переключити світлу/темну тему:</p>
      <button id="settingsThemeToggle" class="btn ghost">Toggle theme</button>
    </div>
  `;

  const btn = qs("#settingsThemeToggle");
  if (btn && !btn.dataset._wired) {
    btn.addEventListener("click", () => {
      const next = document.body.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
    });
    btn.dataset._wired = "1";
  }
}

/* ==========================================================
 * 12. WIRING ФОРМ
 * ========================================================*/

function wireCompanyApplyForm() {
  const proofInput = qs("#proofFile");
  const form = qs("#companyForm");
  const msgEl = qs("#applyMsg");

  proofInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await ensureLoggedIn();
      const { url, path } = await uploadFile(file, "brand_proofs");
      form.proofUrl.value = url;
      form.dataset.proofPath = path;
      if (msgEl) {
        msgEl.innerHTML = `Файл завантажено: <a href="${url}" target="_blank">переглянути</a>`;
      }
    } catch (err) {
      alert("Upload error: " + (err.message || err));
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await ensureLoggedIn();
    } catch { return; }

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
      proofPath:    f.dataset.proofPath || ""
    };
    if (!body.fullName || !body.contactEmail || !body.legalName) {
      return alert("Заповніть обовʼязкові поля: Імʼя, Email, Юр.назва");
    }
    try {
      await api("/api/company/apply", { method: "POST", body });
      trackEvent("company_apply", { email: lastMe?.email });
      f.reset();
      delete f.dataset.proofPath;
      if (msgEl) msgEl.textContent = "Заявку надіслано.";
      await reloadProfile();
      setView("overview");
    } catch (err) {
      alert("Помилка подачі: " + (err.message || err));
    }
  });
}

function wireManufacturerForms() {
  const batchForm = qs("#batchForm");
  const skuBtn = qs("#manuSkuBtn");
  const companyProductForm = qs("#companyProductForm");
  const companyMsg = qs("#companyCreateMsg");
  const userProductForm = qs("#userProductForm");
  const userMsg = qs("#userCreateMsg");

  batchForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = e.target.title?.value.trim();
    if (!title) return alert("Вкажіть назву партії");
    try {
      await api("/api/manufacturer/batches", { method: "POST", body: { title } });
      e.target.reset();
      await loadBatchesSelect();
      trackEvent("create_batch", { email: lastMe?.email });
    } catch (err) {
      alert("Помилка створення партії: " + (err.message || err));
    }
  });

  skuBtn?.addEventListener("click", async () => {
    await loadCompanyProductsFiltered();
  });

  companyProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name:           f.name?.value.trim(),
      sku:            f.sku?.value.trim(),
      manufacturedAt: f.manufacturedAt?.value.trim(),
      image:          f.image?.value.trim(),
      editionCount:   parseInt(f.editionCount?.value || "1", 10) || 1,
      certificates:   (f.certificates?.value || "")
                        .split(",").map(s => s.trim()).filter(Boolean),
      batchId:        f.batchId?.value.trim()
    };
    if (!body.name) return alert("Назва обовʼязкова");
    try {
      await api("/api/manufacturer/products", { method: "POST", body });
      if (companyMsg) companyMsg.textContent = "Створено.";
      f.reset();
      await loadCompanyProductsFiltered();
      trackEvent("create_company_product", { email: lastMe?.email });
    } catch (err) {
      alert("Помилка створення товару: " + (err.message || err));
    }
  });

  userProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name:           f.name?.value.trim(),
      sku:            f.sku?.value.trim(),
      manufacturedAt: f.manufacturedAt?.value.trim(),
      image:          f.image?.value.trim(),
      editionCount:   parseInt(f.editionCount?.value || "1", 10) || 1,
      certificates:   (f.certificates?.value || "")
                        .split(",").map(s => s.trim()).filter(Boolean)
    };
    if (!body.name) return alert("Назва обовʼязкова");
    try {
      await api("/api/user/products", { method: "POST", body });
      if (userMsg) userMsg.textContent = "Створено.";
      f.reset();
      await loadUserProducts();
      setView("products");
      trackEvent("create_user_product", { email: lastMe?.email });
    } catch (err) {
      alert("Помилка створення товару: " + (err.message || err));
    }
  });
}

/* ==========================================================
 * 13. AUTH LIFECYCLE
 * ========================================================*/

async function reloadProfile() {
  if (!lastUser) return;
  try {
    const me = await api("/api/me");
    lastMe = me;
    renderTopbar(me, lastUser);
    renderProfile(me, lastUser);
    renderOverview(me);
  } catch (e) {
    console.error("load /api/me:", e.message || e);
  }
}

function initAuth() {
  const loginBtn = qs("#loginBtn");
  const logoutBtn = qs("#logoutBtn");

  loginBtn?.addEventListener("click", () => Auth.signIn());
  logoutBtn?.addEventListener("click", () => Auth.signOut());

  Auth.onChange(async (user) => {
    lastUser = user || null;
    document.body.classList.toggle("authed", !!user);
    loginBtn && (loginBtn.style.display = user ? "none" : "");
    logoutBtn && (logoutBtn.style.display = user ? "" : "none");

    if (!user) {
      lastMe = null;
      // чистимо основні блоки
      ["#profileCard", "#overviewStats", "#overviewChart",
       "#myProducts", "#myProductsCompany", "#myBatches",
       "#messagesList"].forEach(sel => {
        const el = qs(sel);
        if (el) el.innerHTML = "";
      });
      setView("overview"); // пустий
      return;
    }

    // трекаємо логін
    trackEvent("login", { email: user.email });

    try {
      const me = await api("/api/me");
      lastMe = me;
      renderTopbar(me, user);
      renderProfile(me, user);
      renderOverview(me);
      await loadUserProducts();
      // якщо адмін — показуємо overview, інакше – профіль
      if (me.isAdmin) setView("overview");
      else setView("profile");
    } catch (e) {
      console.error("me load error:", e.message || e);
    }
  });
}

/* ==========================================================
 * 14. INIT
 * ========================================================*/

(function init() {
  initTheme();
  initSidebar();
  initNav();
  wireCompanyApplyForm();
  wireManufacturerForms();
  initAuth();
})();
