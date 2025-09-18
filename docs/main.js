import { API, Auth, api, qs, qsa, h, flash, makeQR, productUrl } from "./app.js";
import { uploadFile } from "./firebase.js";

/** Навігація */
function setView(view) {
  qsa(".view").forEach(v => (v.style.display = "none"));
  const el = qs(`#view-${view}`);
  if (el) el.style.display = "block";
  qsa(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
}

function setupNav() {
  qsa(".nav-btn").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
}

/** Профіль + список продуктів */
async function loadProfile() {
  const me = await api("/api/me");
  const box = qs("#profileBox");
  box.innerHTML = "";

  box.append(
    h("div", { class: "meta" }, `Email: ${me.email}`),
    h("div", { class: "meta" }, `Адмін: ${me.isAdmin ? "так" : "ні"}`),
    h("div", { class: "meta" }, `Має компанію: ${me.isManufacturer ? "так" : "ні"}`),
    h("div", { class: "meta" }, "Бренди: ", (me.brands || []).map(b => `${b.name} (${b.slug})`).join(", ") || "—"),
    me.companyApplicationStatus ? h("div", { class: "meta" }, `Статус заявки: ${me.companyApplicationStatus}`) : null
  );

  // якщо нема компанії і нема pending-статусу — покажемо питання про роль
  if (!me.isManufacturer && !me.companyApplicationStatus) {
    setView("role");
  }

  await loadMyProducts();
}

async function loadMyProducts() {
  const grid = qs("#myProducts");
  grid.innerHTML = "";
  let list = [];
  try {
    list = await api("/api/products");
  } catch (e) {
    grid.append(h("div", { class: "muted" }, String(e.message)));
    return;
  }
  if (!list.length) {
    grid.append(h("div", { class: "muted" }, "Ще немає продуктів."));
    return;
  }
  for (const p of list) grid.append(productCard(p, { showQR: true }));
}

function productCard(p, opts = {}) {
  const url = productUrl(p.tokenId);
  const qrBox = h("div", { class: "qr" });
  if (opts.showQR) makeQR(qrBox, url, 160);

  const copyBtn = h("button", {
    class: "copy btn",
    onclick() { navigator.clipboard.writeText(String(p.tokenId)); flash("tokenId скопійовано"); },
  }, "Скопіювати tokenId");

  const openBtn = h("a", { href: url, target: "_blank", class: "copy btn" }, "Відкрити сторінку");

  return h("div", { class: "product-card" },
    h("div", { class: "row" },
      h("span", { class: "badge" }, p.state || "—"),
      p.brandSlug ? h("span", { class: "badge" }, p.brandSlug) : null,
      h("span", { class: "badge" }, `#${p.tokenId}`),
      h("span", { class: "badge" }, `${p.editionNo}/${p.editionTotal}`),
      p.sku ? h("span", { class: "badge" }, `SKU ${p.sku}`) : null,
      p.batchId ? h("span", { class: "badge" }, `batch ${p.batchId}`) : null
    ),
    h("div", { class: "meta" }, p.meta?.name || p.name || "Без назви"),
    h("div", { class: "meta" }, `Виготовлено: ${p.meta?.manufacturedAt || p.manufacturedAt || "—"}`),
    h("div", { class: "meta" }, `Власник: ${p.owner || "—"}`),
    opts.showQR ? qrBox : null,
    h("div", { class: "row" }, copyBtn, openBtn)
  );
}

/** ——— питання про роль / заявка ——— */
function setupRoleAndApply() {
  qs("#btnRoleNo")?.addEventListener("click", () => setView("profile"));
  qs("#btnRoleYes")?.addEventListener("click", () => setView("apply"));
  qs("#applyBack")?.addEventListener("click", () => setView("role"));

  const form = qs("#companyApplyForm");
  const out = qs("#applyOut");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    out.textContent = "Надсилання…";

    try {
      const fd = new FormData(form);
      const payload = {
        fullName: (fd.get("fullName") || "").toString().trim(),
        contactEmail: (fd.get("contactEmail") || "").toString().trim().toLowerCase(),
        legalName: (fd.get("legalName") || "").toString().trim(),
        brandName: (fd.get("brandName") || "").toString().trim(),
        country: (fd.get("country") || "").toString().trim(),
        vat: (fd.get("vat") || "").toString().trim(),
        regNumber: (fd.get("regNumber") || "").toString().trim(),
        site: (fd.get("site") || "").toString().trim(),
        phone: (fd.get("phone") || "").toString().trim(),
        address: (fd.get("address") || "").toString().trim()
      };

      const file = fd.get("proof");
      const { url: proofUrl, path: proofPath } = await uploadFile(file, "brand_proofs");

      const res = await api("/api/company/apply", {
        method: "POST",
        body: { ...payload, proofUrl, proofPath }
      });

      out.textContent = "Заявку відправлено. Статус: pending";
      flash("Заявка подана. Ми повідомимо після перевірки.");
      form.reset();
      setView("profile");
      await loadProfile();
    } catch (err) {
      out.textContent = err.message || String(err);
    }
  });
}

/** ——— створення продуктів (користувач) ——— */
function setupUserCreate() {
  const form = qs("#userCreateForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      sku: (fd.get("sku") || "").toString().trim().toUpperCase(),
      manufacturedAt: fd.get("manufacturedAt") || undefined,
      image: fd.get("image") || undefined,
      editionCount: Number(fd.get("editionCount") || 1),
      certificates: (fd.get("certs") || "").toString()
        .split(",").map(s => s.trim()).filter(Boolean),
    };
    const box = qs("#userCreateResult");
    box.innerHTML = "";
    try {
      const res = await api("/api/user/products", { method: "POST", body: payload });
      const items = Array.isArray(res) ? res : [res];
      items.forEach(p => box.append(productCard(p, { showQR: true })));
      flash("Створено!");
      await loadMyProducts();
    } catch (err) {
      flash(err.message);
    }
  });

  // Пошук за SKU (користувач)
  qs("#btnSkuSearchUser")?.addEventListener("click", async ()=>{
    const sku = (qs("#skuQueryUser")?.value || "").trim().toUpperCase();
    const box = qs("#skuUserResults"); box.innerHTML = "";
    if (!sku) return;
    try{
      const list = await api(`/api/products?sku=${encodeURIComponent(sku)}`);
      (list || []).forEach(p => box.append(productCard(p, { showQR:false })));
      if (!list?.length) box.append(h("div",{class:"muted"},"Нічого не знайдено."));
    }catch(e){ box.append(h("div",{class:"muted"}, e.message)); }
  });
}

/** ——— партії + створення продуктів (компанія) ——— */
let currentBatchId = "";

async function refreshBatches() {
  try {
    const list = await api("/api/manufacturer/batches");
    const sel = qs("#batchSelect");
    sel.innerHTML = "";
    sel.append(new Option("Без партії", "", true, !currentBatchId));
    (list || []).forEach(b => {
      const opt = new Option(`${b.title || "Без назви"} — ${b.id}`, b.id, false, b.id === currentBatchId);
      sel.append(opt);
    });
    sel.onchange = ()=> currentBatchId = sel.value || "";
  } catch (e) {
    qs("#batchOut").textContent = e.message;
  }
}

function setupCompanyCreate() {
  qs("#btnCreateBatch")?.addEventListener("click", async ()=>{
    const title = (qs("#batchTitle")?.value || "").trim();
    qs("#batchOut").textContent = "Створення партії…";
    try{
      const b = await api("/api/manufacturer/batches", { method:"POST", body:{ title } });
      currentBatchId = b.id;
      await refreshBatches();
      qs("#batchOut").textContent = `Створено: ${b.id}`;
      qs("#batchTitle").value = "";
    }catch(e){ qs("#batchOut").textContent = e.message; }
  });

  refreshBatches().catch(()=>{});

  const form = qs("#companyCreateForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      sku: (fd.get("sku") || "").toString().trim().toUpperCase(),
      manufacturedAt: fd.get("manufacturedAt") || undefined,
      image: fd.get("image") || undefined,
      editionCount: Number(fd.get("editionCount") || 1),
      certificates: (fd.get("certs") || "").toString()
        .split(",").map(s => s.trim()).filter(Boolean),
      batchId: currentBatchId || undefined
    };
    const box = qs("#companyCreateResult");
    box.innerHTML = "";
    try {
      const res = await api("/api/manufacturer/products", { method: "POST", body: payload });
      const items = Array.isArray(res) ? res : [res];
      items.forEach(p => box.append(productCard(p, { showQR: true })));
      flash("Створено (компанія)!");
      await loadMyProducts();
    } catch (err) {
      flash(err.message);
    }
  });

  // Пошук за SKU (компанія) — показує тільки свої
  qs("#btnSkuSearchCompany")?.addEventListener("click", async ()=>{
    const sku = (qs("#skuQueryCompany")?.value || "").trim().toUpperCase();
    const box = qs("#skuCompanyResults"); box.innerHTML = "";
    if (!sku) return;
    try{
      const list = await api(`/api/manufacturer/products?sku=${encodeURIComponent(sku)}`);
      (list || []).forEach(p => box.append(productCard(p, { showQR:false })));
      if (!list?.length) box.append(h("div",{class:"muted"},"Нічого не знайдено."));
    }catch(e){ box.append(h("div",{class:"muted"}, e.message)); }
  });
}

/** ——— адмінка ——— */
async function refreshAdmins() {
  try {
    const data = await api("/api/admins");
    qs("#adminsList").textContent = "Адміни: " + (data.admins || []).join(", ");
  } catch (e) {
    qs("#adminsList").textContent = e.message;
  }
}

function setupAdmin() {
  qs("#bootstrapAdmin")?.addEventListener("click", async () => {
    try {
      await api("/api/admins/bootstrap", { method: "POST" });
      flash("Готово. Ви — адмін.");
      await refreshAdmins();
    } catch (e) {
      flash(e.message);
    }
  });

  qs("#grantAdminForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get("email");
    try {
      await api("/api/admins/grant", { method: "POST", body: { email } });
      flash("Адміна додано");
      await refreshAdmins();
    } catch (er) {
      flash(er.message);
    }
  });

  // verify brand
  qs("#verifyBrandForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const slug = (fd.get("slug")||"").toString().trim().toUpperCase().replace(/\s+/g,"-");
    const out = qs("#verifyOut");
    out.textContent = "Верифікація…";
    try{
      const res = await api(`/api/manufacturers/${encodeURIComponent(slug)}/verify`, { method:"POST" });
      out.textContent = `Верифіковано: ${res.slug}`;
      e.currentTarget.reset();
    }catch(err){ out.textContent = err.message; }
  });

  // applications moderation
  const listEl = qs("#appsList");
  qs("#btnLoadApps")?.addEventListener("click", async ()=>{
    listEl.innerHTML = "Завантаження…";
    try{
      const apps = await api("/api/admins/company-applications?status=pending");
      listEl.innerHTML = "";
      (apps||[]).forEach(a=>{
        const item = h("div",{class:"item"},
          h("div",{}, h("b",{}, a.brandName || a.legalName || "Заявка"), " — ", a.country || "—"),
          h("div",{class:"meta"}, `email: ${a.contactEmail} / vat: ${a.vat || "—"}`),
          a.proofUrl ? h("div",{}, h("a",{href:a.proofUrl,target:"_blank"},"Переглянути доказ")): null,
          h("div",{class:"actions"},
            h("button",{class:"btn primary", onclick:()=>approve(a.id)},"Approve"),
            h("button",{class:"btn danger", onclick:()=>reject(a.id)},"Reject")
          )
        );
        listEl.append(item);
      });
      if (!apps?.length) listEl.innerHTML = "<div class='muted'>Немає нових заявок.</div>";
    }catch(e){ listEl.innerHTML = `<div class='muted'>${e.message}</div>`; }
  });

  async function approve(id){
    try{ await api(`/api/admins/company-applications/${encodeURIComponent(id)}/approve`, {method:"POST"}); flash("Approved"); qs("#btnLoadApps").click(); }
    catch(e){ flash(e.message); }
  }
  async function reject(id){
    const reason = prompt("Причина відхилення:");
    try{ await api(`/api/admins/company-applications/${encodeURIComponent(id)}/reject`, {method:"POST", body:{ reason }});
      flash("Rejected"); qs("#btnLoadApps").click();
    } catch(e){ flash(e.message); }
  }
}

/** ——— логін/логаут ——— */
function setupAuth() {
  const loginBtn = qs("#loginBtn");
  const logoutBtn = qs("#logoutBtn");

  Auth.onChange(async (user) => {
    if (user) {
      loginBtn.style.display = "none";
      logoutBtn.style.display = "";
      await loadProfile();
    } else {
      loginBtn.style.display = "";
      logoutBtn.style.display = "none";
      qs("#profileBox").innerHTML = "";
      qs("#myProducts").innerHTML = "";
      setView("profile");
    }
  });
}

/** ——— init ——— */
function init() {
  setupNav();
  setupAuth();
  setupRoleAndApply();
  setupUserCreate();
  setupCompanyCreate();
  setupAdmin();
  setView("profile");
  refreshAdmins().catch(() => {});
}
init();
