// admin.js
import { api, qs } from "/js/app.js";
import { Auth } from "/js/firebase.js";

const meInfo = qs("#meInfo");
const grantSection = qs("#grantSection");
const brandSection = qs("#brandSection");
const verifySection = qs("#verifySection");

const grantForm = qs("#grantAdminForm");
const grantOut = qs("#grantOut");

const brandForm = qs("#createBrandForUserForm");
const brandOut = qs("#brandCreateOut");

const verifyForm = qs("#verifyBrandForm");
const verifyOut = qs("#verifyOut");

const logoutBtn = qs("#logoutBtn");
const bootstrapBtn = qs("#bootstrapBtn");

Auth.onChange(async (u) => {
  logoutBtn?.classList.toggle("hidden", !u);
  if (!u) {
    meInfo.textContent = "Увійдіть як адмін.";
    [grantSection, brandSection, verifySection].forEach(s => s && (s.style.display = "none"));
    return;
  }
  try {
    const me = await api("/api/me");
    if (!me.isAdmin) {
      meInfo.textContent = "Доступ заборонено (не адмін).";
      [grantSection, brandSection, verifySection].forEach(s => s && (s.style.display = "none"));
      return;
    }
    meInfo.innerHTML = `<b>${me.email}</b> — Admin`;
    [grantSection, brandSection, verifySection].forEach(s => s && (s.style.display = ""));
  } catch (e) {
    meInfo.textContent = e.message || "Помилка /api/me";
  }
});

logoutBtn?.addEventListener("click", () => Auth.signOut());

bootstrapBtn?.addEventListener("click", async () => {
  try {
    const res = await api("/api/admins/bootstrap", { method: "POST" });
    alert("OK: " + JSON.stringify(res));
    location.reload();
  } catch (e) {
    alert(e.message || "Помилка bootstrap");
  }
});

grantForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(grantForm);
  const email = (fd.get("email") || "").toString().trim().toLowerCase();
  grantOut.textContent = "Надання прав…";
  try {
    await api("/api/admins/grant", { method: "POST", body: { email } });
    grantOut.textContent = "Готово.";
    grantForm.reset();
  } catch (e) { grantOut.textContent = e.message || "Помилка"; }
});

brandForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(brandForm);
  const name = (fd.get("name") || "").toString().trim();
  const email = (fd.get("email") || "").toString().trim().toLowerCase();
  brandOut.textContent = "Створення…";
  try {
    const res = await api("/api/admins/create-manufacturer", { method: "POST", body: { name, email } });
    brandOut.textContent = `Створено: ${res.name} (${res.slug}) → ${res.owner}`;
    brandForm.reset();
  } catch (e) { brandOut.textContent = e.message || "Помилка"; }
});

// ВАЖЛИВО: не міняємо регістр і пробіли у slug, бекенд сам slugify-дефенсивний.
verifyForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(verifyForm);
  const slug = (fd.get("slug") || "").toString().trim();
  verifyOut.textContent = "Верифікація…";
  try {
    const res = await api(`/api/manufacturers/${encodeURIComponent(slug)}/verify`, { method: "POST" });
    verifyOut.textContent = `Верифіковано: ${res.slug}`;
    verifyForm.reset();
  } catch (e) { verifyOut.textContent = e.message || "Помилка"; }
});
