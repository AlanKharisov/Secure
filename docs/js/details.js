// details.js — сторінка перевірки одного продукту
import { api } from "./app.js";
import { Auth } from "./firebase.js";
// ESM-версія QRCode:
import QRCode from "https://esm.sh/qrcode@1.5.3";

const qs = (s, d = document) => d.querySelector(s);
const params = new URLSearchParams(location.search);
const id = Number.parseInt(params.get("id") || "0", 10);

function setAuthButtons(user) {
  const loginBtn = qs("#loginBtn");
  const logoutBtn = qs("#logoutBtn");
  if (loginBtn)  loginBtn.style.display  = user ? "none" : "";
  if (logoutBtn) logoutBtn.style.display = user ? "" : "none";
}

async function renderQR(url) {
  const c = qs("#qr");
  if (!c) return;
  await QRCode.toCanvas(c, url, { margin: 1, scale: 4 });
}

function friendlyState(state) {
  switch (String(state || "").toLowerCase()) {
    case "created":   return "створено";
    case "purchased": return "у власності покупця";
    case "claimed":   return "підтверджено";
    case "revoked":   return "скасовано";
    default:          return state || "—";
  }
}

function friendlyScope(scope) {
  return scope === "full"
    ? "Повний доступ (власник або адміністратор)"
    : "Публічний перегляд";
}

function renderDetails(data) {
  const box = qs("#details");
  if (!box) return;

  const meta = data.metadata || {};
  const img = meta.image
    ? `<img src="${meta.image}" alt="" style="max-width:220px;border-radius:16px;box-shadow:var(--shadow-soft);">`
    : "";

  const certs = (meta.certificates || [])
    .map(c => `<li>${c}</li>`).join("") || "<li>—</li>";

  const serialPart = meta.serial
    ? `<p><b>Serial:</b> ${meta.serial}</p>`
    : `<p class="muted small">Серійний номер приховано для публічного перегляду.</p>`;

  box.innerHTML = `
    <div class="row">
      <div>
        ${img}
        <div class="mt">
          <canvas id="qr"></canvas>
          <div class="muted tiny">Скануйте QR, щоб відкрити цю сторінку.</div>
        </div>
      </div>
      <div>
        <h3 style="margin-top:0">${meta.name || "ITEM"}</h3>
        <p><b>Token:</b> ${data.tokenId}</p>
        <p><b>Brand:</b> ${data.brandSlug || "—"}</p>
        <p><b>SKU:</b> ${data.sku || "—"}</p>
        <p><b>Edition:</b> ${data.editionNo || 1}/${data.editionTotal || 1}</p>
        <p><b>Manufactured:</b> ${meta.manufacturedAt || "—"}</p>
        ${serialPart}
        <p>
          <b>State:</b>
          <span class="tag">${friendlyState(data.state)}</span>
        </p>
        <p>
          <b>Режим перегляду:</b>
          <span class="tag">${friendlyScope(data.scope)}</span>
        </p>
        <p><b>Certificates:</b></p>
        <ul>${certs}</ul>
      </div>
    </div>
  `;
}

function renderActions(data) {
  const act = qs("#actions");
  if (!act) return;

  const user = Auth.user || null;

  // Гість
  if (!user) {
    act.innerHTML = `
      <div class="muted small">
        Ви переглядаєте публічну сторінку продукту.
        <br>Увійдіть у акаунт, щоб, за можливості, отримати продукт у власність
        або побачити більше деталей.
        <div class="mt">
          <button id="actionsLoginBtn" class="btn tiny">Увійти</button>
        </div>
      </div>
    `;
    qs("#actionsLoginBtn")?.addEventListener("click", () => Auth.signIn());
    return;
  }

  // Власник або адмін (scope = full)
  if (data.scope === "full") {
    act.innerHTML = `
      <div class="muted small">
        Цей продукт належить вам (або ви адміністратор).
        Ви бачите повну інформацію, включно з серійним номером.
      </div>
    `;
    return;
  }

  // Авторизований юзер, який може отримати продукт
  if (data.canAcquire) {
    act.innerHTML = `
      <form id="buy">
        <button class="btn">Отримати у власність</button>
        <p class="tiny muted mt">
          Після підтвердження товар буде закріплено за вашим акаунтом
          і зʼявиться у розділі "Мої товари".
        </p>
      </form>
    `;
    const buy = qs("#buy");
    buy?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = buy.querySelector("button");
      btn?.setAttribute("disabled", "true");
      try {
        await api(`/api/products/${id}/purchase`, { method: "POST" });
        await load(); // перерендер
      } catch (err) {
        alert("Помилка: " + (err.message || err));
      } finally {
        btn?.removeAttribute("disabled");
      }
    });
    return;
  }

  // Авторизований, але не може отримати (товар вже у когось або недоступний)
  act.innerHTML = `
    <div class="muted small">
      Цей продукт зараз недоступний для отримання у власність.
      Можливо, він вже закріплений за іншим користувачем
      або переведений у стан, де передача недоступна.
    </div>
  `;
}

async function load() {
  const box = qs("#details");
  if (!id || !Number.isFinite(id)) {
    if (box) box.textContent = "Некоректний ідентифікатор продукту.";
    return;
  }
  try {
    const data = await api(`/api/verify/${id}`);
    renderDetails(data);
    renderActions(data);
    await renderQR(location.href);
  } catch (e) {
    if (box) box.textContent = e.message || "Помилка завантаження.";
    qs("#actions") && (qs("#actions").innerHTML = "");
  }
}

// auth lifecycle
(function initAuth() {
  qs("#loginBtn")?.addEventListener("click", () => Auth.signIn());
  qs("#logoutBtn")?.addEventListener("click", () => Auth.signOut());

  Auth.onChange(async (user) => {
    setAuthButtons(user);
    await load();
  });
})();

// стартове завантаження
load();
