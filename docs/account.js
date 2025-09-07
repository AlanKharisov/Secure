"use strict";

var API = window.API_BASE || window.location.origin;
function $(s, sc=document){ return sc.querySelector(s); }
function esc(s){ return (s == null ? "" : String(s)).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); }); }
function authUser(){ return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
function authHeaders(){ var u = authUser(); return u ? { "X-User": u } : {}; }

var qs = new URLSearchParams(location.search);
var id  = qs.get("id");

function render(j){
  var box = $("#content");
  var imgHTML = (j.metadata.image || "").trim()
    ? '<img class="prodimg" src="' + esc(j.metadata.image) + '" alt="Фото">'
    : '<div class="muted">Немає зображення</div>';

  var isFull = j.scope === "full";
  var serial = isFull ? esc(j.metadata.serial) : "приховано";
  var ipfs   = isFull ? esc(j.ipfsHash || "-") : "приховано";
  var serialHash = isFull ? esc(j.serialHash || "-") : "приховано";

  var buyBtn = (!isFull && j.state === "created")
    ? '<div style="margin-top:12px"><button id="buyBtn" class="btn primary">Купити (отримати у власність)</button></div>'
    : '';

  var certs = (j.metadata.certificates || []);
  var certsHTML = certs.length ? certs.map(function(c){ return '<span class="badge">'+esc(c)+'</span>'; }).join(" ") : '<span class="muted">немає</span>';

  box.innerHTML = '' +
    '<div class="hero">' +
      '<div class="imgwrap">' + imgHTML + '</div>' +
      '<div class="info">' +
        '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between">' +
          '<h2 style="margin:0">' + esc(j.metadata.name) + '</h2>' +
          '<span class="badge">' + esc(j.state) + '</span>' +
        '</div>' +
        '<div class="mono" style="margin-top:6px">TokenId: ' + esc(String(j.tokenId)) + '</div>' +
        '<div class="mono">Serial: ' + serial + '</div>' +
        '<div class="mono">SerialHash: ' + serialHash + '</div>' +
        '<div class="mono">IPFS: ' + ipfs + '</div>' +
        '<div>Вироблено: ' + esc(j.metadata.manufacturedAt || "-") + '</div>' +
        '<div style="margin-top:10px">Сертифікати: ' + certsHTML + '</div>' +
        buyBtn +
      '</div>' +
    '</div>';

  var btn = document.getElementById("buyBtn");
  if (btn) {
    btn.addEventListener("click", function(){
      if (!authUser()) { alert("Увійдіть, будь ласка."); return; }
      btn.disabled = true;
      fetch(API + "/api/products/" + encodeURIComponent(j.tokenId) + "/purchase", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: "{}"
      }).then(function(res){ return res.json().then(function(ok){ return { ok: res.ok, data: ok }; }); })
        .then(function(r){
          if (!r.ok) throw new Error(r.data && r.data.error || "error");
          alert("Готово! Ви стали власником. Перезавантажую сторінку…");
          location.reload();
        })
        .catch(function(e){ alert(e.message); })
        .finally(function(){ btn.disabled = false; });
    });
  }
}

function load(){
  var box = $("#content");
  if (!id) { box.innerHTML = '<div class="result bad">Немає id</div>'; return; }
  fetch(API + "/api/verify/" + encodeURIComponent(id), { headers: authHeaders() })
    .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, data: j }; }); })
    .then(function(r){
      if (!r.ok) throw new Error(r.data && r.data.error || "Not found");
      render(r.data);
    })
    .catch(function(e){
      box.innerHTML = '<div class="result bad">Помилка: ' + esc(e.message) + '</div>';
    });
}

document.addEventListener("auth-changed", load);
load();
