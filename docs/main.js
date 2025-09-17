import {
  API, Auth, api, qs, qsa, h, flash, makeQR, downloadCanvasPng, productUrl
} from "./app.js";

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
    h("div", { class: "meta" }, `Має бренд: ${me.isManufacturer ? "так" : "ні"}`),
    h("div", { class: "meta" }, "Бренди: ", (me.brands || []).map(b => `${b.name} (${b.slug})`).join(", ") || "—")
  );

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

  for (const p of list) {
    grid.append(productCard(p, { showQR: true }));
  }
}

/** Карточка продукту (з QR, копіюванням tokenId, кнопкою переходу) */
function productCard(p, opts = {}) {
  const url = productUrl(p.tokenId);

  const qrBox = h("div", { class: "qr" });
  if (opts.showQR) {
    makeQR(qrBox, url, 160);
  }

  const copyBtn = h("button", {
    class: "copy",
    onclick() {
      navigator.clipboard.writeText(String(p.tokenId));
      flash("tokenId скопійовано");
    },
  }, "Скопіювати tokenId");

  const dlBtn = h("button", {
    class: "copy",
    onclick() {
      const canvas = qrBox.querySelector("canvas");
      if (canvas) downloadCanvasPng(canvas, `qr-${p.tokenId}.png`);
    },
  }, "Завантажити QR");

  const openBtn = h("a", { href: url, target: "_blank", class: "copy" }, "Відкрити сторінку");

  return h("div", { class: "product-card" },
    h("div", { class: "row" },
      h("span", { class: "badge" }, p.state),
      p.brandSlug ? h("span", { class: "badge" }, p.brandSlug) : null,
      h("span", { class: "badge" }, `#${p.tokenId}`),
      h("span", { class: "badge" }, `${p.editionNo}/${p.editionTotal}`)
    ),
    h("div", { class: "meta" }, p.meta?.name || "Без назви"),
    h("div", { class: "meta" }, `Виготовлено: ${p.meta?.manufacturedAt || "—"}`),
    h("div", { class: "meta" }, `Власник: ${p.owner || "—"}`),
    opts.showQR ? qrBox : null,
    h("div", { class: "row" }, copyBtn, dlBtn, openBtn)
  );
}

/** ——— створення продуктів (користувач) ——— */
function setupUserCreate() {
  const form = qs("#userCreateForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      manufacturedAt: fd.get("manufacturedAt") || undefined,
      image: fd.get("image") || undefined,
      editionCount: Number(fd.get("editionCount") || 1),
      certificates: (fd.get("certs") || "")
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
}

/** ——— створення продуктів (компанія) ——— */
function setupCompanyCreate() {
  const form = qs("#companyCreateForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      manufacturedAt: fd.get("manufacturedAt") || undefined,
      image: fd.get("image") || undefined,
      editionCount: Number(fd.get("editionCount") || 1),
      certificates: (fd.get("certs") || "")
        .split(",").map(s => s.trim()).filter(Boolean),
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
  qs("#bootstrapAdmin").addEventListener("click", async () => {
    try {
      await api("/api/admins/bootstrap", { method: "POST" });
      flash("Готово. Ви — адмін.");
      await refreshAdmins();
    } catch (e) {
      flash(e.message);
    }
  });

  qs("#grantAdminForm").addEventListener("submit", async (e) => {
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

  qs("#createBrandForUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { name: fd.get("name"), email: fd.get("email") };
    try {
      const m = await api("/api/admins/create-manufacturer", { method: "POST", body });
      flash(`Бренд створено: ${m.name} (${m.slug})`);
    } catch (er) {
      flash(er.message);
    }
  });
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
    }
  });

  loginBtn.addEventListener("click", () => Auth.signIn());   // <-- правильно
  logoutBtn.addEventListener("click", () => Auth.signOut());
}

/** ——— init ——— */
function init() {
  setupNav();
  setupAuth();
  setupUserCreate();
  setupCompanyCreate();
  setupAdmin();
  setView("profile");
  refreshAdmins().catch(() => {});
}
init();
