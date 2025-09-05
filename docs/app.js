"use strict";

var API = window.API_BASE || window.location.origin;

function $(s, sc){ return (sc || document).querySelector(s); }
function authUser(){ return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
function authHeaders(){ var u = authUser(); return u ? { "X-User": u } : {}; }
function esc(s){ return (s == null ? "" : String(s)).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); }); }

function addQuery(url, params) {
  var u = new URL(url, window.location.origin);
  Object.keys(params || {}).forEach(function(k){
    var v = params[k];
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  return u.toString();
}

/* Tabs */
var tabButtons = document.querySelectorAll(".tab");
tabButtons.forEach(function(btn){
  btn.addEventListener("click", function(){
    document.querySelectorAll(".tab").forEach(function(b){ b.classList.remove("active"); });
    document.querySelectorAll(".tabpane").forEach(function(p){ p.classList.remove("active"); });
    btn.classList.add("active");
    var pane = $("#" + btn.dataset.tab);
    if (pane) pane.classList.add("active");

    var tab = btn.dataset.tab;
    if (tab === "manufacturer") loadManufacturerProducts();
    if (tab === "admin") loadAllProducts();
    if (tab === "user") renderMyOwnedFromCache();
  });
});

/* Roles */
var CURRENT_ROLES = { email:"", isAdmin:false, isManufacturer:false, brands:[] };
document.addEventListener("roles-ready", function(e){
  CURRENT_ROLES = e.detail || CURRENT_ROLES;
  if (CURRENT_ROLES.isManufacturer) loadManufacturerProducts();
  renderMyOwnedFromCache();
  if (CURRENT_ROLES.isAdmin) loadAllProducts();
});

/* QR */
var publicQR = null;
function getPublicQR() {
  var node = document.getElementById("publicQR");
  if (!node) return null;
  if (!publicQR) publicQR = new QRCode(node, { text: "", width: 180, height: 180 });
  return publicQR;
}

/* Create form */
var createForm = $("#createForm");
var createdBlock = $("#createdBlock");
var lastCreatedUrl = "";

if (createForm) {
  createForm.addEventListener("submit", function(e){
    e.preventDefault();

    var fd = new FormData(createForm);
    var name = (fd.get("name") || "").toString().trim();
    var mfg  = (fd.get("mfg") || "").toString().trim();
    var image= (fd.get("image") || "").toString().trim();
    var edStr= (fd.get("edition") || "1").toString().trim();
    var edition = Math.max(1, parseInt(edStr, 10) || 1);

    if (!authUser()) { alert("Увійдіть"); return; }
    if (!CURRENT_ROLES.isManufacturer) { alert("Ви не виробник"); return; }
    if (!name) { alert("Назва обовʼязкова"); return; }

    var primaryBrand = (CURRENT_ROLES.brands && CURRENT_ROLES.brands[0]) ? CURRENT_ROLES.brands[0].slug : "";
    if (!primaryBrand) { alert("У вас немає бренду. Зверніться до адміна або створіть бренд."); return; }

    var body = { name: name, brand: primaryBrand };
    if (mfg) body.manufacturedAt = mfg;
    if (image) body.image = image;
    if (edition && edition > 1) body.edition = edition;

    fetch(API + "/api/manufacturer/products", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function(res){ return res.json().then(function(j){ return { ok: res.ok, data: j }; }); })
      .then(function(r){
        if (!r.ok) throw new Error(r.data && r.data.error || "Create failed");

        var p = r.data;
        var baseUrl = p.publicUrl || (API + "/details.html?id=" + p.id);
        var url = addQuery(baseUrl, { s: p.serialHash || "" });
        lastCreatedUrl = url;

        if (createdBlock) createdBlock.classList.remove("hidden");
        var el1 = $("#createdId");     if (el1) el1.textContent = p.id;
        var el2 = $("#createdState");  if (el2) el2.textContent = p.state;
        var el3 = $("#createdUrl");    if (el3) el3.textContent = url;

        var qr = getPublicQR();
        if (qr) { qr.clear(); qr.makeCode(url); }

        loadManufacturerProducts();
        renderMyOwnedFromCache();
        createForm.reset();
      })
      .catch(function(err){ alert(err.message); });
  });
}

/* Download QR */
var dlBtn = $("#downloadQR");
if (dlBtn) {
  dlBtn.addEventListener("click", function(){
    var node = document.querySelector("#publicQR canvas") || document.querySelector("#publicQR img");
    if (!node) { alert("QR ще не згенерований"); return; }
    var dataURL = "";
    if (node.tagName.toLowerCase() === "canvas") dataURL = node.toDataURL("image/png");
    else dataURL = node.src || "";
    if (!dataURL) { alert("Не вдалося отримати QR"); return; }

    var a = document.createElement("a");
    a.href = dataURL;
    a.download = "qr.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

/* Copy URL */
var copyBtn = $("#copyUrl");
if (copyBtn) {
  copyBtn.addEventListener("click", function(){
    if (!lastCreatedUrl) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastCreatedUrl).then(function(){
        alert("Посилання скопійовано");
      }, function(){
        alert("Не вдалося скопіювати");
      });
    } else {
      alert("Clipboard API недоступний");
    }
  });
}

/* Tables */
var manufBody = $("#productsBody");
var allBody   = $("#allBody");
var myBody    = $("#myBody");

var _lastProducts = [];

function loadManufacturerProducts() {
  if (!manufBody) return;
  if (!authUser()) {
    manufBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть</td></tr>';
    return;
  }
  manufBody.innerHTML = '<tr><td colspan="6" class="muted">Завантаження…</td></tr>';

  fetch(API + "/api/products", { headers: authHeaders() })
    .then(function(res){ return res.json(); })
    .then(function(list){
      _lastProducts = Array.isArray(list) ? list : [];

      if (!_lastProducts.length) {
        manufBody.innerHTML = '<tr><td colspan="6" class="muted">Ще немає продуктів</td></tr>';
        renderMyOwnedFromCache();
        return;
      }
      manufBody.innerHTML = "";
      _lastProducts.forEach(function(p){
        var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(p.id), { s: p.serialHash || "" });
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td>' + p.id + '</td>' +
          '<td>' + esc(p.meta && p.meta.name || "") + '</td>' +
          '<td class="mono">' + esc(p.meta && p.meta.serial || "") + '</td>' +
          '<td class="mono">' + esc(p.meta && (p.meta.edition || "1")) + '</td>' +
          '<td><span class="badge">' + esc(p.state) + '</span></td>' +
          '<td>' +
            '<a class="btn" href="' + detailsUrl + '" target="_blank" rel="noopener">Деталі</a> ' +
            (p.state === "created" ? '<button class="btn" data-buy="' + p.id + '">Позначити купленим (передати мені)</button>' : '') +
          '</td>';
        manufBody.appendChild(tr);
      });

      var buys = manufBody.querySelectorAll("[data-buy]");
      buys.forEach(function(btn){
        btn.addEventListener("click", function(){
          var id = btn.getAttribute("data-buy");
          markPurchased(id);
        });
      });

      renderMyOwnedFromCache();
    })
    .catch(function(e){
      console.error("loadManufacturerProducts:", e);
      manufBody.innerHTML = '<tr><td colspan="6" class="muted">Помилка завантаження</td></tr>';
    });
}

function loadAllProducts() {
  if (!allBody) return;
  if (!authUser()) {
    allBody.innerHTML = '<tr><td colspan="7" class="muted">Увійдіть</td></tr>';
    return;
  }
  allBody.innerHTML = '<tr><td colspan="7" class="muted">Завантаження…</td></tr>';

  fetch(API + "/api/products?all=1", { headers: authHeaders() })
    .then(function(res){ return res.json(); })
    .then(function(list){
      if (!Array.isArray(list) || !list.length) {
        allBody.innerHTML = '<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>';
        return;
      }
      allBody.innerHTML = "";
      list.forEach(function(p){
        var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(p.id), { s: p.serialHash || "" });
        var brand = (p.meta && (p.meta.brand || p.brand)) || "";
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td>' + p.id + '</td>' +
          '<td>' + esc(p.meta && p.meta.name || "") + '</td>' +
          '<td class="mono">' + esc(p.meta && p.meta.serial || "") + '</td>' +
          '<td class="mono">' + esc(p.meta && (p.meta.edition || "1")) + '</td>' +
          '<td>' + esc(brand) + '</td>' +
          '<td><span class="badge">' + esc(p.state) + '</span></td>' +
          '<td><a class="btn" href="' + detailsUrl + '" target="_blank" rel="noopener">Деталі</a></td>';
        allBody.appendChild(tr);
      });
    })
    .catch(function(e){
      console.error("loadAllProducts:", e);
      allBody.innerHTML = '<tr><td colspan="7" class="muted">Помилка завантаження</td></tr>';
    });
}

function renderMyOwnedFromCache() {
  if (!myBody) return;
  var me = authUser();
  if (!me) {
    myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>';
    return;
  }
  var mine = _lastProducts.filter(function(p){ return (p.owner || "").toLowerCase() === me.toLowerCase(); });
  myBody.innerHTML = "";
  if (!mine.length) {
    myBody.innerHTML = '<tr><td colspan="6" class="muted">Ще немає товарів</td></tr>';
  } else {
    var pCnt=0, cCnt=0, clCnt=0;
    mine.forEach(function(pdt){
      if (pdt.state === "purchased") pCnt++;
      else if (pdt.state === "created") cCnt++;
      else if (pdt.state === "claimed") clCnt++;
      var img = (pdt.meta && pdt.meta.image || "").trim() ? '<img class="thumb" src="' + esc(pdt.meta.image) + '" alt="">' : "";
      var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(pdt.id), { s: pdt.serialHash || "" });
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + img + '</td>' +
        '<td>' + esc(pdt.meta && pdt.meta.name || "-") + '</td>' +
        '<td class="mono">' + esc(pdt.meta && pdt.meta.serial || "-") + '</td>' +
        '<td class="mono">' + pdt.id + '</td>' +
        '<td><span class="badge">' + esc(pdt.state) + '</span></td>' +
        '<td><a class="btn" href="' + detailsUrl + '" target="_blank" rel="noopener">Відкрити</a></td>';
      myBody.appendChild(tr);
    });
    var kp1 = document.getElementById("kPurchased"); if (kp1) kp1.textContent = String(pCnt);
    var kp2 = document.getElementById("kCreated");   if (kp2) kp2.textContent = String(cCnt);
    var kp3 = document.getElementById("kClaimed");   if (kp3) kp3.textContent = String(clCnt);
  }
}

function markPurchased(id) {
  if (!authUser()) { alert("Будь ласка, увійдіть у свій акаунт."); return; }
  fetch(API + "/api/products/" + id + "/purchase", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
    body: "{}"
  }).then(function(res){ return res.json().then(function(j){ return { ok: res.ok, data: j }; }); })
    .then(function(r){
      if (!r.ok) throw new Error(r.data && r.data.error || "Failed");
      loadManufacturerProducts();
      renderMyOwnedFromCache();
      alert("Власність передано вам");
    })
    .catch(function(e){ alert(e.message); });
}

/* Якщо вже авторизований — стартові дані */
if (window.Auth && window.Auth.user) {
  renderMyOwnedFromCache();
}
