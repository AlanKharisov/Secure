"use strict";

const API = window.API_BASE || window.location.origin;
const $ = (s, sc=document) => sc.querySelector(s);
const esc = s => (s == null ? "" : String(s)).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);
const authUser = () => (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
const authHeaders = () => { const u = authUser(); return u ? { "X-User": u } : {}; };

const qs = new URLSearchParams(location.search);
const id  = qs.get("id");

function render(prod){
  const box = $("#content");
  const meta = prod.meta || {};
  const imgHTML = (meta.image || "").trim()
    ? `<img class="prodimg" src="${esc(meta.image)}" alt="Фото">`
    : '<div class="muted">Немає зображення</div>';

  const serial = esc(meta.serial || "-");
  const ipfs   = esc(prod.ipfsHash || "-");
  const serialHash = esc(prod.serialHash || "-");

  const canBuy = (prod.state === "created");
  const buyBtn = canBuy
    ? '<div style="margin-top:12px"><button id="buyBtn" class="btn primary">Купити (отримати у власність)</button></div>'
    : '';

  const certs = (meta.certificates || []);
  const certsHTML = certs.length ? certs.map(c => `<span class="badge">${esc(c)}</span>`).join(" ") : '<span class="muted">немає</span>';

  box.innerHTML = '' +
    '<div class="hero">' +
      '<div class="imgwrap">' + imgHTML + '</div>' +
      '<div class="info">' +
        '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between">' +
          '<h2 style="margin:0">' + esc(meta.name || "") + '</h2>' +
          '<span class="badge">' + esc(prod.state) + '</span>' +
        '</div>' +
        '<div class="mono" style="margin-top:6px">TokenId: ' + esc(String(prod.id)) + '</div>' +
        '<div class="mono">Serial: ' + serial + '</div>' +
        '<div class="mono">SerialHash: ' + serialHash + '</div>' +
        '<div class="mono">IPFS: ' + ipfs + '</div>' +
        '<div>Вироблено: ' + esc(meta.manufacturedAt || "-") + '</div>' +
        '<div style="margin-top:10px">Сертифікати: ' + certsHTML + '</div>' +
        buyBtn +
      '</div>' +
    '</div>';

  const btn = document.getElementById("buyBtn");
  if (btn) {
    btn.addEventListener("click", async function(){
      if (!authUser()) { alert("Увійдіть, будь ласка."); return; }
      btn.disabled = true;
      try {
        const r = await fetch(`${API}/api/products/${encodeURIComponent(prod.id)}/purchase`, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
          body: "{}"
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j && j.error || "error");
        // локально збережемо покупку
        const item = {
          id: prod.id,
          name: meta.name,
          serial: meta.serial,
          image: meta.image,
          publicUrl: prod.publicUrl || (`${API}/details.html?id=${prod.id}`),
          state: "purchased",
          purchasedAt: Date.now()
        };
        if (window.__MARKI__ && typeof window.__MARKI__.addLocalPurchase === "function"){
          window.__MARKI__.addLocalPurchase(item);
        } else {
          // запасний варіант (без account.js)
          const KEY = "marki.purchases.v1";
          const cur = JSON.parse(localStorage.getItem(KEY) || "[]");
          if (!cur.some(x => Number(x.id) === Number(item.id))) cur.push(item);
          localStorage.setItem(KEY, JSON.stringify(cur));
        }
        alert("Готово! Ви стали власником. Перезавантажую сторінку…");
        location.reload();
      } catch(e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    });
  }
}

function load(){
  const box = $("#content");
  if (!id) { box.innerHTML = '<div class="result bad">Немає id</div>'; return; }
  fetch(API + "/api/verify/" + encodeURIComponent(id), { headers: authHeaders() })
    .then(res => res.json().then(j => ({ ok: res.ok, data: j })))
    .then(r => {
      if (!r.ok) throw new Error(r.data && r.data.error || "Not found");
      render(r.data);
    })
    .catch(e => {
      box.innerHTML = '<div class="result bad">Помилка: ' + esc(e.message) + '</div>';
    });
}

document.addEventListener("auth-changed", load);
document.addEventListener("DOMContentLoaded", load);
