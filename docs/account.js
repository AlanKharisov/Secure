"use strict";

const API = window.API_BASE || window.location.origin;
const $ = (s, sc=document) => sc.querySelector(s);
const esc = s => (s == null ? "" : String(s)).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);
const authUser = () => (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
const authHeaders = () => { const u = authUser(); return u ? { "X-User": u } : {}; };

// Локальне сховище покупок (щоб "Мої товари" одразу з’являлись на цьому пристрої)
const PURCHASES_KEY = "marki.purchases.v1";
function loadPurchasesLS(){
  try { return JSON.parse(localStorage.getItem(PURCHASES_KEY) || "[]"); } catch { return []; }
}
function savePurchasesLS(items){
  localStorage.setItem(PURCHASES_KEY, JSON.stringify(items||[]));
}
function addPurchaseLS(item){
  const cur = loadPurchasesLS();
  if (!cur.some(x => Number(x.id) === Number(item.id))) {
    cur.push(item);
    savePurchasesLS(cur);
  }
}

function renderProfile(me){
  const pName = $("#pName"), pEmail = $("#pEmail"), pPhoto = $("#pPhoto"), pBrands = $("#pBrands");
  const user = window.Auth?.user;
  if (pName)  pName.textContent = (user?.displayName || user?.email || "") || "";
  if (pEmail) pEmail.textContent = user?.email || "";
  if (pPhoto) {
    if (user?.photoURL) { pPhoto.src = user.photoURL; pPhoto.style.display = "inline-block"; }
    else pPhoto.style.display = "none";
  }
  if (pBrands) {
    pBrands.innerHTML = "";
    const list = Array.isArray(me?.brands) ? me.brands : [];
    if (!list.length) {
      const span = document.createElement("span");
      span.className = "muted small";
      span.textContent = "— немає брендів —";
      pBrands.appendChild(span);
    } else {
      list.forEach(b => {
        const chip = document.createElement("span");
        chip.className = "badge";
        chip.textContent = b.name + (b.verified ? " ✓" : "");
        pBrands.appendChild(chip);
      });
    }
  }
}

function renderPurchases(){
  const body = $("#myBody");
  if (!body) return;
  const user = authUser();
  if (!user) {
    body.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>';
    $("#kPurchased") && ($("#kPurchased").textContent = "0");
    $("#kClaimed") && ($("#kClaimed").textContent = "0");
    return;
  }
  const items = loadPurchasesLS();
  if (!items.length){
    body.innerHTML = '<tr><td colspan="6" class="muted">Ще немає придбаних товарів на цьому пристрої</td></tr>';
  } else {
    body.innerHTML = "";
    let cClaim = 0;
    items.forEach(p => {
      if (p.state === "claimed") cClaim++;
      const tr = document.createElement("tr");
      const img = p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : "";
      const url = p.publicUrl || (`details.html?id=${encodeURIComponent(p.id)}`);
      tr.innerHTML =
        `<td>${img}</td>` +
        `<td>${esc(p.name||"-")}</td>` +
        `<td class="mono">${esc(p.serial||"-")}</td>` +
        `<td class="mono">${p.id}</td>` +
        `<td><span class="badge">${esc(p.state||"purchased")}</span></td>` +
        `<td><a class="btn" href="${url}" target="_blank" rel="noopener">Відкрити</a></td>`;
      body.appendChild(tr);
    });
    $("#kClaimed") && ($("#kClaimed").textContent = String(cClaim));
  }
  $("#kPurchased") && ($("#kPurchased").textContent = String(items.length));
}

// Для компаній — порахувати створені товари (за брендом користувача)
async function refreshCreatedCounter(){
  const me = await fetch(API + "/api/me", { headers: authHeaders() }).then(r=>r.json()).catch(()=>null);
  if (!me || !(me.isCompany || me.isAdmin)) { $("#kCreated") && ($("#kCreated").textContent="0"); return; }
  const list = await fetch(API + "/api/products", { headers: authHeaders() }).then(r=>r.json()).catch(()=>[]);
  const created = Array.isArray(list) ? list.filter(p => p && p.state === "created") : [];
  $("#kCreated") && ($("#kCreated").textContent = String(created.length || 0));
}

// Завантаження/поточний рендер
async function load(){
  const user = authUser();
  const loginBtn = $("#loginBtn"), logoutBtn = $("#logoutBtn");
  if (!user) {
    loginBtn && (loginBtn.style.display = "");
    logoutBtn && (logoutBtn.style.display = "none");
    renderPurchases();
    $("#kCreated") && ($("#kCreated").textContent="0");
    return;
  }
  loginBtn && (loginBtn.style.display = "none");
  logoutBtn && (logoutBtn.style.display = "");

  try {
    const me = await fetch(API + "/api/me", { headers: authHeaders() }).then(r=>r.json());
    renderProfile(me);
  } catch {
    // ок
  }
  renderPurchases();
  refreshCreatedCounter();
}

document.addEventListener("auth-changed", load);
document.addEventListener("DOMContentLoaded", load);

// Експортуємо хук для деталей/кошика, щоб записувати покупки
window.__MARKI__ = window.__MARKI__ || {};
window.__MARKI__.addLocalPurchase = addPurchaseLS;

