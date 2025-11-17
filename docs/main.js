// main.js — MARKI Secure dashboard logic
import { api, qs, qsa } from "./app.js";
import { Auth, uploadFile } from "./firebase.js";

/* ---------- helpers ---------- */

function setView(view) {
  // Перемикаємо секції
  qsa("[data-view]").forEach(sec => {
    sec.style.display = sec.dataset.view === view ? "" : "none";
  });
  // Активна кнопка в сайдбарі
  qsa(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.nav === view);
  });
}

/* ---------- renderers ---------- */

function updateTopbarAndSidebar(me) {
  const emailSpan = qs("#topbarEmail");
  const roleSpan = qs("#topbarRole");
  const sidebarRoleTag = qs("#sidebarRoleTag");
  const sidebarBrandTag = qs("#sidebarBrandTag");
  const sidebarAppTag = qs("#sidebarAppTag");
  const adminNav = qs('[data-nav="admin"]');

  if (!me) {
    if (emailSpan) emailSpan.textContent = "Неавторизований";
    if (roleSpan) roleSpan.textContent = "Гість";
    if (sidebarRoleTag) sidebarRoleTag.textContent = "guest";
    if (sidebarBrandTag) {
      sidebarBrandTag.textContent = "немає";
      sidebarBrandTag.classList.remove("tag-approved");
    }
    if (sidebarAppTag) {
      sidebarAppTag.textContent = "—";
      sidebarAppTag.classList.remove("tag-approved", "tag-rejected", "tag-pending");
    }
    if (adminNav) adminNav.style.display = "none";
    return;
  }

  const appStatus = me.companyApplicationStatus ?? null;

  if (emailSpan) emailSpan.textContent = me.email || "—";
  if (roleSpan) {
    roleSpan.textContent = me.isAdmin
      ? "Адмін"
      : me.isManufacturer
      ? "Виробник"
      : "Користувач";
  }

  if (sidebarRoleTag) {
    sidebarRoleTag.textContent = me.isAdmin
      ? "admin"
      : me.isManufacturer
      ? "manufacturer"
      : "user";
  }

  if (sidebarBrandTag) {
    if (me.brands && me.brands.length) {
      const b = me.brands[0];
      sidebarBrandTag.textContent = b.slug || "brand";
      sidebarBrandTag.classList.toggle("tag-approved", !!b.verified);
    } else {
      sidebarBrandTag.textContent = "немає";
      sidebarBrandTag.classList.remove("tag-approved");
    }
  }

  if (sidebarAppTag) {
    const st = appStatus || "—";
    sidebarAppTag.textContent = st;
    sidebarAppTag.classList.remove("tag-approved", "tag-rejected", "tag-pending");
    if (st === "approved") sidebarAppTag.classList.add("tag-approved");
    else if (st === "rejected") sidebarAppTag.classList.add("tag-rejected");
    else if (st === "pending") sidebarAppTag.classList.add("tag-pending");
  }

  if (adminNav) adminNav.style.display = me.isAdmin ? "" : "none";
}

function renderProfile(me) {
  const appStatus = me.companyApplicationStatus ?? null;

  const statusChip = appStatus
    ? `<span class="tag tag-${appStatus}">${appStatus}</span>`
    : `<span class="tag">—</span>`;

  const brands = (me.brands || []).length
    ? `<ul>${me.brands
        .map(
          (b) => `
        <li>
          <b>${b.name}</b> <small>(${b.slug})</small>
          ${b.verified ? '<span class="tag tag-approved">verified</span>' : ""}
        </li>`
        )
        .join("")}</ul>`
    : "—";

  const box = qs("#profileBox");
  if (box) {
    box.innerHTML = `
      <h3>Мій профіль</h3>
      <p><b>Емейл:</b> ${me.email}</p>
      <p><b>Адмін:</b> ${me.isAdmin ? "так" : "ні"}</p>
      <p><b>Мої бренди:</b> ${brands}</p>
      <h4>Статус заявки</h4>
      <p>${statusChip}</p>
      ${
        !me.isManufacturer && !appStatus
          ? `<div class="muted small">
               Ще немає компанії. Перейдіть на вкладку <b>Компанія</b>, щоб подати заявку.
             </div>`
          : ""
      }
    `;
  }

  updateTopbarAndSidebar(me);
}

function renderProductsList(list, el) {
  if (!el) return;
  if (!Array.isArray(list) || !list.length) {
    el.innerHTML = `<div class="muted small">Немає продуктів</div>`;
  } else {
    el.innerHTML = list
      .map(
        (p) => `
      <div class="card">
        <div class="row">
          <div class="col">
            <div><b>${p.meta?.name || "ITEM"}</b></div>
            <div class="muted small">Token: ${p.tokenId}</div>
            <div class="muted small">SKU: ${p.sku || "—"}</div>
            <div class="muted small">Edition: ${p.editionNo || 1}/${
          p.editionTotal || 1
        }</div>
            <div class="muted small">
              State: <span class="tag">${p.state}</span>
            </div>
          </div>
          <div class="col right">
            ${
              p.publicUrl
                ? `<a class="btn secondary" target="_blank" href="${p.publicUrl}">Деталі</a>`
                : ""
            }
          </div>
        </div>
      </div>`
      )
      .join("");
  }

  // KPI
  const count = Array.isArray(list) ? list.length : 0;
  if (el.id === "myProducts") {
    const kpi = qs("#kpiMyProducts");
    if (kpi) kpi.textContent = String(count);
  }
  if (el.id === "myProductsCompany") {
    const kpi = qs("#kpiCompanyProducts");
    if (kpi) kpi.textContent = String(count);
  }
}

function renderAdminApps(list) {
  const wrap = qs("#adminApps");
  if (!wrap) return;

  if (!Array.isArray(list) || !list.length) {
    wrap.innerHTML = `<div class="muted small">Немає заявок</div>`;
    return;
  }

  wrap.innerHTML = list
    .map(
      (a) => `
    <div class="card" data-app="${a.id}">
      <h4>${a.brandName || a.legalName}</h4>
      <p><b>Заявник:</b> ${a.fullName} &lt;${a.contactEmail || a.user}&gt;</p>
      <p><b>Країна:</b> ${a.country || "—"} | <b>VAT:</b> ${
        a.vat || "—"
      } | <b>Reg#:</b> ${a.regNumber || "—"}</p>
      <p><b>Сайт:</b> ${a.site || "—"} | <b>Тел:</b> ${a.phone || "—"}</p>
      <p><b>Адреса:</b> ${a.address || "—"}</p>
      <p><b>Доказ:</b> ${
        a.proofUrl ? `<a href="${a.proofUrl}" target="_blank">переглянути</a>` : "—"
      }</p>
      <div class="row mt">
        <button class="btn" data-approve="${a.id}">Approve</button>
        <button class="btn danger" data-reject="${a.id}">Reject</button>
      </div>
    </div>`
    )
    .join("");
}

/* ---------- loaders ---------- */

async function loadProfile() {
  const me = await api("/api/me");
  renderProfile(me);

  // Мої юзерські продукти
  try {
    const list = await api("/api/products");
    renderProductsList(list, qs("#myProducts"));
  } catch (e) {
    console.warn("my products:", e.message || e);
    renderProductsList([], qs("#myProducts"));
  }

  // Якщо є бренд або заявка вже approved — тягнемо виробничі дані
  if (me.isManufacturer || me.companyApplicationStatus === "approved") {
    await Promise.all([loadBatches(), loadCompanyProducts()]);
  }

  if (me.isAdmin) {
    await loadAdminPending();
  }
}

async function loadBatches() {
  try {
    const list = await api("/api/manufacturer/batches");
    const el = qs("#myBatches");

    if (el) {
      if (!list.length) {
        el.innerHTML = `<div class="muted small">Партій ще немає</div>`;
      } else {
        el.innerHTML = list
          .map(
            (b) => `
          <div class="card">
            <b>${b.title}</b> <small class="muted">#${b.id}</small>
          </div>`
          )
          .join("");
      }
    }

    // select у формі товарів компанії
    const sel = qs('#companyProductForm select[name="batchId"]');
    if (sel) {
      sel.innerHTML =
        `<option value="">— без партії —</option>` +
        list.map((b) => `<option value="${b.id}">${b.title}</option>`).join("");
    }

    const kpiB = qs("#kpiBatches");
    if (kpiB) kpiB.textContent = String(list.length || 0);
  } catch (e) {
    console.warn("batches:", e.message || e);
  }
}

async function loadCompanyProducts() {
  const sku = (qs("#manuSkuFilter")?.value || "").trim().toUpperCase();
  const url = sku
    ? `/api/manufacturer/products?sku=${encodeURIComponent(sku)}`
    : `/api/manufacturer/products`;
  try {
    const list = await api(url);
    renderProductsList(list, qs("#myProductsCompany"));
  } catch (e) {
    console.warn("company products:", e.message || e);
    renderProductsList([], qs("#myProductsCompany"));
  }
}

async function loadAdminPending() {
  try {
    const list = await api("/api/admins/company-applications?status=pending");
    renderAdminApps(list);
  } catch (e) {
    console.warn("admin pending:", e.message || e);
  }
}

/* ---------- wiring ---------- */

function wireNav() {
  qsa(".nav-item").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const view = btn.dataset.nav || "profile";
      setView(view);

      if (view === "company") {
        await Promise.allSettled([loadBatches(), loadCompanyProducts()]);
      }
      if (view === "admin") {
        await loadAdminPending();
      }
    });
  });
}

function wireCompanyApply() {
  const fileInput = qs("#proofFile");
  const form = qs("#companyForm");
  const msg = qs("#applyMsg");

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!Auth.user) return alert("Увійдіть спочатку");

      try {
        const { url, path } = await uploadFile(file, "brand_proofs");
        if (form) {
          form.querySelector('[name="proofUrl"]').value = url;
          form.dataset.proofPath = path;
        }
        if (msg) {
          msg.innerHTML = `Файл завантажено: <a href="${url}" target="_blank">переглянути</a>`;
        }
      } catch (err) {
        alert("Upload error: " + (err.message || err));
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!Auth.user) return alert("Увійдіть спочатку");

      const f = e.target;
      const body = {
        fullName: f.fullName?.value.trim(),
        contactEmail: f.contactEmail?.value.trim(),
        legalName: f.legalName?.value.trim(),
        brandName: f.brandName?.value.trim(),
        country: f.country?.value.trim(),
        vat: f.vat?.value.trim(),
        regNumber: f.regNumber?.value.trim(),
        site: f.site?.value.trim(),
        phone: f.phone?.value.trim(),
        address: f.address?.value.trim(),
        proofUrl: f.proofUrl?.value.trim(),
        proofPath: form.dataset.proofPath || "",
      };

      if (!body.fullName || !body.contactEmail || !body.legalName) {
        return alert("Заповніть обовʼязкові поля: Імʼя, Email, Юр.назва");
      }

      try {
        await api("/api/company/apply", { method: "POST", body });
        f.reset();
        delete form.dataset.proofPath;
        if (msg) msg.textContent = "Заявку надіслано.";
        setView("profile");
        await loadProfile();
      } catch (err) {
        alert("Помилка подачі: " + (err.message || err));
      }
    });
  }
}

function wireManufacturer() {
  const batchForm = qs("#batchForm");
  if (batchForm) {
    batchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = e.target.title?.value.trim();
      if (!title) return alert("Вкажіть назву партії");
      try {
        await api("/api/manufacturer/batches", {
          method: "POST",
          body: { title },
        });
        e.target.reset();
        await loadBatches();
      } catch (err) {
        alert("Помилка створення партії: " + (err.message || err));
      }
    });
  }

  const skuBtn = qs("#manuSkuBtn");
  if (skuBtn) {
    skuBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await loadCompanyProducts();
    });
  }

  const companyProductForm = qs("#companyProductForm");
  if (companyProductForm) {
    companyProductForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        name: f.name?.value.trim(),
        sku: f.sku?.value.trim(),
        manufacturedAt: f.manufacturedAt?.value.trim(),
        image: f.image?.value.trim(),
        editionCount: parseInt(f.editionCount?.value || "1", 10) || 1,
        certificates: (f.certificates?.value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        batchId: f.batchId?.value.trim(),
      };
      if (!body.name) return alert("Назва обовʼязкова");

      try {
        await api("/api/manufacturer/products", { method: "POST", body });
        const m = qs("#companyCreateMsg");
        if (m) m.textContent = "Створено.";
        f.reset();
        await loadCompanyProducts();
      } catch (err) {
        alert("Помилка створення товару: " + (err.message || err));
      }
    });
  }

  const userProductForm = qs("#userProductForm");
  if (userProductForm) {
    userProductForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        name: f.name?.value.trim(),
        sku: f.sku?.value.trim(),
        manufacturedAt: f.manufacturedAt?.value.trim(),
        image: f.image?.value.trim(),
        editionCount: parseInt(f.editionCount?.value || "1", 10) || 1,
        certificates: (f.certificates?.value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (!body.name) return alert("Назва обовʼязкова");

      try {
        await api("/api/user/products", { method: "POST", body });
        const m = qs("#userCreateMsg");
        if (m) m.textContent = "Створено.";
        f.reset();
        await loadProfile();
        setView("profile");
      } catch (err) {
        alert("Помилка створення товару: " + (err.message || err));
      }
    });
  }
}

function wireAdmin() {
  const wrap = qs("#adminApps");
  if (!wrap) return;

  wrap.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;

    if (b.dataset.approve) {
      const id = b.dataset.approve;
      try {
        await api(`/api/admins/company-applications/${id}/approve`, {
          method: "POST",
        });
        await Promise.all([loadAdminPending(), loadProfile()]);
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
          body: { reason },
        });
        await Promise.all([loadAdminPending(), loadProfile()]);
      } catch (err) {
        alert("Reject error: " + (err.message || err));
      }
    }
  });
}

/* ---------- auth lifecycle ---------- */

async function setupAuth() {
  setView("profile");

  // Додаткові кнопки входу/виходу (якщо firebase.js вже вішав — дубль не шкодить)
  qs("#loginBtn")?.addEventListener("click", () => Auth.signIn());
  qs("#logoutBtn")?.addEventListener("click", () => Auth.signOut());

  Auth.onChange(async (user) => {
    const loginBtn = qs("#loginBtn");
    const logoutBtn = qs("#logoutBtn");
    if (loginBtn) loginBtn.style.display = user ? "none" : "";
    if (logoutBtn) logoutBtn.style.display = user ? "" : "none";

    if (!user) {
      // Очистити вміст
      [
        "#profileBox",
        "#myProducts",
        "#myProductsCompany",
        "#myBatches",
        "#adminApps",
        "#applyMsg",
        "#companyCreateMsg",
        "#userCreateMsg",
      ].forEach((sel) => {
        const el = qs(sel);
        if (el) el.innerHTML = "";
      });

      // KPI
      qs("#kpiMyProducts") && (qs("#kpiMyProducts").textContent = "—");
      qs("#kpiCompanyProducts") && (qs("#kpiCompanyProducts").textContent = "—");
      qs("#kpiBatches") && (qs("#kpiBatches").textContent = "—");

      updateTopbarAndSidebar(null);
      setView("profile");
      return;
    }

    try {
      await loadProfile();
    } catch (e) {
      console.error("loadProfile:", e.message || e);
    }
  });
}

/* ---------- init ---------- */

(function init() {
  wireNav();
  wireCompanyApply();
  wireManufacturer();
  wireAdmin();
  setupAuth();
})();
