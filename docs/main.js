import { Auth, uploadFile } from "./firebase.js";
import { api } from "./app.js";

// ——— DOM helpers ———
const qs  = (s, r=document)=>r.querySelector(s);
const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));
const on  = (el, ev, fn)=>el && el.addEventListener(ev, fn);

function setView(name) {
  qsa("main > section").forEach(s => s.classList.add("hidden"));
  qs(`#view-${name}`)?.classList.remove("hidden");
  qsa("nav .tab").forEach(t => t.classList.toggle("active", t.dataset.view===name));
}
on(document.getElementById("tabs"), "click", (e)=>{
  const t = e.target.closest(".tab"); if (!t) return; setView(t.dataset.view);
});

function txt(sel, v){ const el=qs(sel); if(el) el.textContent=v??""; }
function html(sel, v){ const el=qs(sel); if(el) el.innerHTML=v??""; }
function show(sel, yes=true){ const el=qs(sel); if(el) el.style.display = yes?"":"none"; }
const parseCSV = (s)=> (s||"").split(",").map(x=>x.trim()).filter(Boolean);

// ——— RENDER ———
function renderProducts(items) {
  const box = qs("#myProducts");
  const list = Array.isArray(items)? items : [];
  if (!list.length) { box.innerHTML = `<div class="empty">Немає продуктів</div>`; return; }
  box.innerHTML = list.map(p=>`
    <div class="card">
      <div class="row"><strong>#${p.tokenId}</strong><span>${p?.meta?.name||""}</span></div>
      <div class="muted">SKU: ${p.sku||"—"} · Вид. ${p.editionNo||1}/${p.editionTotal||1}</div>
      <div class="muted">Стан: ${p.state||"created"}</div>
      ${p.publicUrl? `<a class="btn" href="${p.publicUrl}" target="_blank" rel="noopener">Деталі</a>`:""}
    </div>
  `).join("");
}
function renderBatches(items) {
  const box = qs("#batchesBox");
  const list = Array.isArray(items)? items : [];
  if (!list.length) { box.innerHTML = `<div class="empty">Партій ще немає</div>`; return; }
  box.innerHTML = list.map(b=>`
    <div class="row"><strong>${b.title}</strong><span class="muted">#${b.id}</span></div>
  `).join("");
  // наповнимо селект для створення товару компанією
  const sel = qs("#batchSelect");
  if (sel) {
    sel.innerHTML = `<option value="">(без партії)</option>` +
      list.map(b=>`<option value="${b.id}">${b.title}</option>`).join("");
  }
}

// ——— LOADERS ———
async function loadMyProducts() {
  try {
    const data = await api("/api/products");
    renderProducts(Array.isArray(data)? data : []);
  } catch (e) {
    console.error("loadMyProducts:", e);
    renderProducts([]);
  }
}
async function loadMyBatches() {
  try {
    const data = await api("/api/manufacturer/batches");
    renderBatches(Array.isArray(data)? data : []);
  } catch (e) {
    console.warn("loadMyBatches:", e);
    renderBatches([]);
  }
}

async function loadPendingApps() {
  try {
    const list = await api("/api/admins/company-applications?status=pending");
    const box = qs("#adminApps");
    if (!Array.isArray(list) || !list.length) { box.innerHTML = `<div class="empty">Немає заявок</div>`; return; }
    box.innerHTML = list.map(a=>`
      <div class="card">
        <div class="row"><strong>${a.brandName || a.legalName}</strong><span class="muted">${a.contactEmail}</span></div>
        <div class="muted">Країна: ${a.country || "—"} · Статус: ${a.status}</div>
        <div class="actions" style="justify-content:flex-start;margin-top:8px;">
          <button data-act="approve" data-id="${a.id}">Схвалити</button>
          <button data-act="reject" data-id="${a.id}">Відхилити</button>
        </div>
      </div>
    `).join("");
    box.querySelectorAll("[data-act=approve]").forEach(btn=>{
      btn.addEventListener("click", async()=>{
        btn.disabled = true;
        try { await api(`/api/admins/company-applications/${btn.dataset.id}/approve`, { method:"POST" }); await loadPendingApps(); }
        catch(e){ alert(e.message||e); } finally { btn.disabled=false; }
      });
    });
    box.querySelectorAll("[data-act=reject]").forEach(btn=>{
      btn.addEventListener("click", async()=>{
        const reason = prompt("Причина відхилення:");
        if (reason==null) return;
        btn.disabled=true;
        try {
          await api(`/api/admins/company-applications/${btn.dataset.id}/reject`, { method:"POST", body:{ reason } });
          await loadPendingApps();
        } catch(e){ alert(e.message||e); } finally { btn.disabled=false; }
      });
    });
  } catch (e) {
    console.error("loadPendingApps:", e);
    qs("#adminApps").innerHTML = `<div class="empty">Помилка: ${e.message||e}</div>`;
  }
}

// ——— PROFILE ———
export async function loadProfile() {
  try {
    const me = await api("/api/me");
    txt("#meEmail", me?.email || "");
    txt("#meAdmin", me?.isAdmin ? "так" : "ні");

    const st = me?.companyApplicationStatus ?? null;
    txt("#meCompanyStatus",
      st==="approved" ? "апрувнуто" :
      st==="pending"  ? "на модерації" :
      st==="rejected" ? "відхилено" : "—"
    );

    const brands = Array.isArray(me?.brands) ? me.brands : [];
    html("#meBrands", brands.length
      ? brands.map(b=>`<span class="tag">${b.name}${b.verified?" ✅":""}</span>`).join(" ")
      : "—"
    );

    // повідомлення у профілі
    qs("#companyNoticeNone")?.classList.toggle("hidden", !!st);
    qs("#companyNoticePending")?.classList.toggle("hidden", st!=="pending");
    qs("#companyNoticeApproved")?.classList.toggle("hidden", st!=="approved");
    qs("#companyNoticeRejected")?.classList.toggle("hidden", st!=="rejected");

    // виробник?
    const isMf = !!me?.isManufacturer;
    show("#manufacturerArea", isMf);
    if (isMf) await loadMyBatches();

    // продукти — завжди
    await loadMyProducts();

    // адмінка
    if (me?.isAdmin) {
      setView(qs("nav .tab.active")?.dataset.view || "profile"); // не чіпаємо активну вкладку
      await loadPendingApps();
    } else {
      qs("#adminApps").innerHTML = `<div class="empty">Ви не адмін</div>`;
    }

    // підказки на вкладці "Компанія"
    const applyHints = qs("#applyHints");
    if (applyHints) {
      applyHints.textContent =
        !isMf && st!=="pending"
          ? "Після схвалення модератором автоматично з'явиться бренд і панель виробника."
          : st==="pending"
            ? "Заявка на розгляді — дочекайтеся рішення модератора."
            : "Компанію вже підтверджено.";
    }

  } catch (e) {
    console.error("/api/me:", e);
    txt("#meEmail","");
    txt("#meAdmin","ні");
    txt("#meCompanyStatus","—");
    html("#meBrands","—");
    show("#manufacturerArea", false);
    renderProducts([]);
    renderBatches([]);
  }
}

// ——— FORMS ———
function initFormsOnce() {
  if (document.body.dataset.formsInit) return;
  document.body.dataset.formsInit = "1";

  // створення партії
  on(qs("#batchForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    if (!title) return;
    try { await api("/api/manufacturer/batches", { method:"POST", body:{ title } }); f.reset(); await loadMyBatches(); }
    catch (e){ alert(e.message||e); }
  });

  // товар як компанія
  on(qs("#mfProductForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.name.value.trim(),
      sku: f.sku.value.trim(),
      manufacturedAt: f.manufacturedAt.value.trim(),
      image: f.image.value.trim(),
      editionCount: Number(f.editionCount.value || 1),
      certificates: parseCSV(f.certificates.value),
      batchId: f.batchId.value.trim(),
    };
    if (!body.name) return alert("Вкажіть назву");
    try { await api("/api/manufacturer/products", { method:"POST", body }); f.reset(); await loadMyProducts(); }
    catch (e){ alert(e.message||e); }
  });

  // товар як користувач
  on(qs("#userProductForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.name.value.trim(),
      sku: f.sku.value.trim(),
      manufacturedAt: f.manufacturedAt.value.trim(),
      image: f.image.value.trim(),
      editionCount: Number(f.editionCount.value || 1),
      certificates: parseCSV(f.certificates.value),
    };
    if (!body.name) return alert("Вкажіть назву");
    try { await api("/api/user/products", { method:"POST", body }); f.reset(); await loadMyProducts(); }
    catch (e){ alert(e.message||e); }
  });

  // заявка на компанію
  on(qs("#companyForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const body = {
      fullName: f.fullName.value.trim(),
      contactEmail: f.contactEmail.value.trim(),
      legalName: f.legalName.value.trim(),
      brandName: f.brandName.value.trim(),
      country: f.country.value.trim(),
      vat: f.vat.value.trim(),
      regNumber: f.regNumber.value.trim(),
      site: f.site.value.trim(),
      phone: f.phone.value.trim(),
      address: f.address.value.trim(),
      proofUrl: f.proofUrl.value.trim(),
      proofPath: "", // заповниться якщо вантажили файл через Storage
    };
    if (!body.fullName || !body.contactEmail || !body.legalName) return alert("Заповніть обовʼязкові поля");
    try {
      await api("/api/company/apply", { method:"POST", body });
      qs("#applyMsg").textContent = "Заявку надіслано. Очікуйте модерації.";
      f.reset();
      await loadProfile();
      setView("profile");
    } catch (e){ alert(e.message||e); }
  });

  // завантаження файлу-доказу через Firebase Storage
  on(qs("#proofFile"), "change", async (e)=>{
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { url, path } = await uploadFile(file, "brand_proofs");
      const input = qs('#companyForm [name="proofUrl"]');
      if (input) input.value = url;
      // збережемо шлях у data, якщо буде потрібно
      qs("#companyForm").dataset.proofPath = path;
      qs("#applyMsg").innerHTML = `Файл завантажено: <a class="btn" href="${url}" target="_blank">переглянути</a>`;
    } catch (e) { alert("Upload: " + (e.message||e)); }
  });

  // адмін: bootstrap
  on(qs("#adminBootstrap"), "click", async ()=>{
    try { await api("/api/admins/bootstrap", { method:"POST" }); alert("Готово. Перезавантажте сторінку."); }
    catch(e){ alert(e.message||e); }
  });

  // адмін: створення бренду для юзера
  on(qs("#adminCreateBrandForm"), "submit", async (e)=>{
    e.preventDefault();
    const f = e.target;
    const body = { name: f.name.value.trim(), email: f.email.value.trim() };
    if (!body.name || !body.email) return;
    try { await api("/api/admins/create-manufacturer", { method:"POST", body }); qs("#adminMsg").textContent = "Створено"; f.reset(); }
    catch(e){ qs("#adminMsg").textContent = "Помилка: " + (e.message||e); }
  });
}

// ——— AUTH ———
async function setupAuth() {
  const loginBtn  = qs("#loginBtn");
  const logoutBtn = qs("#logoutBtn");
  if (loginBtn)  loginBtn.addEventListener("click", () => Auth.signIn());
  if (logoutBtn) logoutBtn.addEventListener("click", () => Auth.signOut());

  Auth.onChange(async (user)=>{
    if (user) {
      if (loginBtn)  loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
      // префіл контактного емейлу в заявці
      const ce = qs('#companyForm [name="contactEmail"]');
      if (ce) ce.value = user.email || "";
      await loadProfile();
    } else {
      if (loginBtn)  loginBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      setView("profile");
      html("#myProducts","");
      html("#batchesBox","");
    }
  });
}

// ——— init ———
init();
async function init() {
  initFormsOnce();
  await setupAuth();
  setView("profile");
}
