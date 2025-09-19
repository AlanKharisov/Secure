// main.js — ініціалізація UI, рендер профілю/брендів/партій/продуктів
import { Auth } from "./firebase.js";
import { api } from "./app.js";

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

// ——— UI helpers ———
function setText(sel, text) {
  const el = qs(sel);
  if (el) el.textContent = text ?? "";
}
function setHTML(sel, html) {
  const el = qs(sel);
  if (el) el.innerHTML = html ?? "";
}
function show(sel, yes = true) {
  const el = qs(sel);
  if (el) el.style.display = yes ? "" : "none";
}

// ——— Рендер продуктів ———
function renderProducts(items) {
  const box = qs("#myProducts");
  if (!box) return;

  if (!items.length) {
    box.innerHTML = `<div class="empty">Немає продуктів</div>`;
    return;
  }

  box.innerHTML = items.map(p => `
    <div class="card">
      <div class="row">
        <strong>#${p.tokenId}</strong>
        <span>${p.meta?.name || ""}</span>
      </div>
      <div class="muted">
        SKU: ${p.sku || "—"} · Вид. ${p.editionNo || 1}/${p.editionTotal || 1}
      </div>
      <div class="muted">
        Стан: ${p.state || "created"}
      </div>
      ${p.publicUrl ? `<a href="${p.publicUrl}" target="_blank" rel="noopener">Деталі</a>` : ""}
    </div>
  `).join("");
}

// ——— Рендер партій (для виробника) ———
function renderBatches(list) {
  const box = qs("#batchesBox");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="empty">Партій ще немає</div>`;
    return;
  }
  box.innerHTML = list.map(b => `
    <div class="row">
      <strong>${b.title}</strong>
      <span class="muted">#${b.id}</span>
    </div>
  `).join("");
}

// ——— Завантаження мого інвентаря ———
export async function loadMyProducts() {
  try {
    const data = await api("/api/products");
    const items = Array.isArray(data) ? data : [];
    renderProducts(items);
  } catch (e) {
    console.error("loadMyProducts failed:", e);
    renderProducts([]);
  }
}

// ——— Завантаження партій виробника ———
async function loadMyBatches() {
  try {
    const data = await api("/api/manufacturer/batches");
    const list = Array.isArray(data) ? data : [];
    renderBatches(list);
  } catch (e) {
    console.warn("loadMyBatches failed:", e);
    renderBatches([]);
  }
}

// ——— Профіль ———
export async function loadProfile() {
  try {
    const me = await api("/api/me");

    // Верхній блок профілю
    setText("#meEmail", me?.email || "");
    setText("#meAdmin", me?.isAdmin ? "так" : "ні");

    // Статус компанії/заявки
    const st = me?.companyApplicationStatus; // "pending" | "approved" | "rejected" | null
    setText("#meCompanyStatus",
      st === "approved" ? "апрувнуто" :
      st === "pending"  ? "на модерації" :
      st === "rejected" ? "відхилено" : "—"
    );

    // Бренди
    const brands = Array.isArray(me?.brands) ? me.brands : [];
    setHTML("#meBrands", brands.length
      ? brands.map(b => `<span class="tag">${b.name}${b.verified ? " ✅" : ""}</span>`).join(" ")
      : "—"
    );

    // Чи виробник?
    const isMf = !!me?.isManufacturer;
    show("#manufacturerArea", isMf);

    // Якщо виробник — підвантажуємо партії
    if (isMf) {
      await loadMyBatches();
    }

    // Завжди підвантажуємо мої продукти
    await loadMyProducts();

  } catch (e) {
    console.error("/api/me failed:", e);
    // Скидаємо UI до «порожнього» стану
    setText("#meEmail", "");
    setText("#meAdmin", "ні");
    setText("#meCompanyStatus", "—");
    setHTML("#meBrands", "—");
    renderBatches([]);
    renderProducts([]);
  }
}

// ——— Автентифікація та кнопки ———
export async function setupAuth() {
  const loginBtn = qs("#loginBtn");
  const logoutBtn = qs("#logoutBtn");

  // захищено: кліки можуть бути відсутні на деяких сторінках
  if (loginBtn)  loginBtn.addEventListener("click", () => Auth.signIn());
  if (logoutBtn) logoutBtn.addEventListener("click", () => Auth.signOut());

  Auth.onChange(async (user) => {
    if (user) {
      if (loginBtn)  loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
      await loadProfile(); // ЛИШЕ після логіну
    } else {
      if (loginBtn)  loginBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      setHTML("#profileBox", "");
      setHTML("#myProducts", "");
      setHTML("#batchesBox", "");
      // можна показати «ввійдіть, щоб продовжити»
    }
  });
}

// ——— Старт ———
(async function init() {
  await setupAuth();
})();
