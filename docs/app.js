"use strict";

var API = window.API_BASE || window.location.origin;
function $(s, sc){ return (sc || document).querySelector(s); }
function esc(s){ return (s == null ? "" : String(s)).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); }); }
function authUser(){ return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
function authHeaders(){ var u = authUser(); return u ? { "X-User": u } : {}; }
function addQuery(url, params) {
  var u = new URL(url, window.location.origin);
  Object.keys(params || {}).forEach(function(k){
    var v = params[k];
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  return u.toString();
}

// Tabs
document.querySelectorAll(".tab").forEach(function(btn){
  btn.addEventListener("click", function(){
    document.querySelectorAll(".tab").forEach(function(b){ b.classList.remove("active"); });
    document.querySelectorAll(".tabpane").forEach(function(p){ p.classList.remove("active"); });
    btn.classList.add("active");
    var pane = $("#" + btn.dataset.tab);
    if (pane) pane.classList.add("active");

    var tab = btn.dataset.tab;
    if (tab === "manufacturer") { syncIngestUI(); loadManufacturerProducts(); loadKeys(); }
    if (tab === "admin") { loadAllProducts(); }
    if (tab === "user") { renderMyOwnedFromCache(); }
  });
});

// roles
var CURRENT_ROLES = { email:"", isAdmin:false, isManufacturer:false, brands:[] };
document.addEventListener("roles-ready", function(e){
  CURRENT_ROLES = e.detail || CURRENT_ROLES;
  fillBrandSelect(CURRENT_ROLES.brands);
  syncIngestUI();
  if (CURRENT_ROLES.isManufacturer) loadManufacturerProducts();
  if (CURRENT_ROLES.isAdmin) loadAllProducts();
  renderMyOwnedFromCache();
});

// helpers
function fetchJSON(url, opts, expectJson) {
  if (opts === void 0) opts = {};
  if (expectJson === void 0) expectJson = true;
  return fetch(url, opts).then(function(res){
    if (!res.ok) return res.text().then(function(t){ throw new Error(t || ("HTTP " + res.status)); });
    if (!expectJson) return null;
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") === -1) return null;
    return res.json();
  });
}

// QR
var publicQR = null;
function getPublicQR() {
  var node = document.getElementById("publicQR");
  if (!node) return null;
  if (!publicQR) publicQR = new QRCode(node, { text: "", width: 180, height: 180 });
  return publicQR;
}

// Manufacturer form
var createForm = $("#createForm");
var createdBlock = $("#createdBlock");
var lastCreatedUrl = "";
var brandSelect = $("#brandSelect");

function fillBrandSelect(brands) {
  if (!brandSelect) return;
  brandSelect.innerHTML = "";
  if (!Array.isArray(brands) || brands.length === 0) {
    var opt = document.createElement("option");
    opt.value = ""; opt.textContent = "— у вас немає брендів —";
    brandSelect.appendChild(opt);
    brandSelect.disabled = true;
    return;
  }
  brands.forEach(function(b, i){
    var opt = document.createElement("option");
    opt.value = b.slug; opt.textContent = b.name + (b.verified ? " ✓" : "");
    brandSelect.appendChild(opt);
    if (i === 0) brandSelect.value = b.slug;
  });
  brandSelect.disabled = false;
}

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
    if (!CURRENT_ROLES.isManufacturer) { alert("У вас немає бренду/прав виробника"); return; }
    if (!name) { alert("Назва обовʼязкова"); return; }

    var brandSlug = (brandSelect && brandSelect.value) ? brandSelect.value : ((CURRENT_ROLES.brands[0] || {}).slug || "");
    if (!brandSlug) { alert("Не вказаний бренд"); return; }

    var body = { name: name, brand: brandSlug, editionCount: edition };
    if (mfg) body.manufacturedAt = mfg;
    if (image) body.image = image;

    fetchJSON(API + "/api/manufacturer/products", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function(p){
      // если партия — вернётся массив; возьмём первую позицию для QR
      var item = Array.isArray(p) ? p[0] : p;
      if (!item || !item.id) throw new Error("Unexpected response");
      lastCreatedUrl = item.publicUrl || (API + "/details.html?id=" + item.id);
      if (createdBlock) createdBlock.classList.remove("hidden");
      var el1 = $("#createdId");    if (el1) el1.textContent = String(item.id);
      var el2 = $("#createdState"); if (el2) el2.textContent = item.state || "created";
      var el3 = $("#createdUrl");   if (el3) el3.textContent = lastCreatedUrl;

      var qr = getPublicQR();
      if (qr) { qr.clear(); qr.makeCode(lastCreatedUrl); }

      loadManufacturerProducts();
      renderMyOwnedFromCache();
      createForm.reset();
    }).catch(function(err){ alert(err.message); });
  });
}

// Download QR
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

// Copy URL
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

// Tables
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

  fetchJSON(API + "/api/products", { headers: authHeaders() })
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
          '<td class="mono">' + esc(p.editionNo) + '/' + esc(p.editionTotal) + '</td>' +
          '<td><span class="badge">' + esc(p.state) + '</span></td>' +
          '<td><a class="btn" href="' + detailsUrl + '" target="_blank" rel="noopener">Деталі</a></td>';
        manufBody.appendChild(tr);
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

  fetchJSON(API + "/api/products?all=1", { headers: authHeaders() })
    .then(function(list){
      if (!Array.isArray(list) || !list.length) {
        allBody.innerHTML = '<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>';
        return;
      }
      allBody.innerHTML = "";
      list.forEach(function(p){
        var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(p.id), { s: p.serialHash || "" });
        var brand = p.brandSlug || (p.meta && p.meta.brand) || "";
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td>' + p.id + '</td>' +
          '<td>' + esc(p.meta && p.meta.name || "") + '</td>' +
          '<td class="mono">' + esc(p.meta && p.meta.serial || "") + '</td>' +
          '<td class="mono">' + esc(p.editionNo) + '/' + esc(p.editionTotal) + '</td>' +
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
  var me = (authUser() || "").toLowerCase();
  if (!me) {
    myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>';
    return;
  }
  var mine = _lastProducts.filter(function(p){ return (p.owner || "").toLowerCase() === me; });
  myBody.innerHTML = "";
  var pCnt=0, cCnt=0, clCnt=0;
  if (!mine.length) {
    myBody.innerHTML = '<tr><td colspan="6" class="muted">Ще немає товарів</td></tr>';
  } else {
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
  }
  var kp1 = document.getElementById("kPurchased"); if (kp1) kp1.textContent = String(pCnt);
  var kp2 = document.getElementById("kCreated");   if (kp2) kp2.textContent = String(cCnt);
  var kp3 = document.getElementById("kClaimed");   if (kp3) kp3.textContent = String(clCnt);
}

// Integration UI
var createdKeyBox = $("#createdKeyBox");
var createdKeyValue = $("#createdKeyValue");
var ingestUrlInput = $("#ingestUrl");
var copyIngestBtn = $("#copyIngest");
var createKeyBtn = $("#createKey");
var keysBody = $("#keysBody");

function primaryBrandSlug() {
  return (CURRENT_ROLES.brands && CURRENT_ROLES.brands[0]) ? CURRENT_ROLES.brands[0].slug : "";
}
function syncIngestUI() {
  if (!ingestUrlInput) return;
  var slug = primaryBrandSlug();
  if (!slug) {
    ingestUrlInput.value = "";
    return;
  }
  var base = window.API_BASE || window.location.origin;
  ingestUrlInput.value = base + "/api/integrations/ingest?brand=" + slug;
}
if (copyIngestBtn) {
  copyIngestBtn.addEventListener("click", function(){
    if (!ingestUrlInput || !ingestUrlInput.value) return;
    navigator.clipboard?.writeText(ingestUrlInput.value);
  });
}
function loadKeys() {
  if (!keysBody) return;
  var slug = primaryBrandSlug();
  if (!slug) {
    keysBody.innerHTML = '<tr><td colspan="8" class="muted">Немає бренду</td></tr>';
    return;
  }
  fetchJSON(API + "/api/manufacturers/" + encodeURIComponent(slug) + "/keys", { headers: authHeaders() })
    .then(function(data){
      var keys = data && data.keys || [];
      if (!keys.length) {
        keysBody.innerHTML = '<tr><td colspan="8" class="muted">Ключів ще немає</td></tr>';
        return;
      }
      keysBody.innerHTML = "";
      keys.forEach(function(k){
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td class="mono">' + k.id + '</td>' +
          '<td class="mono">' + esc(k.prefix) + '</td>' +
          '<td class="mono">' + esc(k.hashTruncated || "") + '</td>' +
          '<td>' + esc(k.createdBy || "") + '</td>' +
          '<td>' + new Date(k.createdAt || 0).toLocaleString() + '</td>' +
          '<td>' + (k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—") + '</td>' +
          '<td>' + esc(k.lastUsedIP || "—") + '</td>' +
          '<td><button class="btn" data-del="' + k.id + '">Вимкнути</button></td>';
        keysBody.appendChild(tr);
      });
      keysBody.querySelectorAll("[data-del]").forEach(function(btn){
        btn.addEventListener("click", function(){
          var id = btn.getAttribute("data-del");
          disableKey(id);
        });
      });
    })
    .catch(function(){
      keysBody.innerHTML = '<tr><td colspan="8" class="muted">Помилка</td></tr>';
    });
}
function disableKey(id) {
  var slug = primaryBrandSlug();
  if (!slug) return;
  fetchJSON(API + "/api/manufacturers/" + encodeURIComponent(slug) + "/keys/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: authHeaders()
  }).then(function(){
    loadKeys();
  }).catch(function(e){ alert(e.message); });
}
if (createKeyBtn) {
  createKeyBtn.addEventListener("click", function(){
    var slug = primaryBrandSlug();
    if (!slug) { alert("Немає бренду"); return; }
    fetchJSON(API + "/api/manufacturers/" + encodeURIComponent(slug) + "/keys", {
      method: "POST",
      headers: authHeaders()
    }).then(function(k){
      if (createdKeyBox) createdKeyBox.classList.remove("hidden");
      if (createdKeyValue) createdKeyValue.textContent = k.apiKey || "(немає)";
      loadKeys();
    }).catch(function(e){ alert(e.message); });
  });
}

// preload if already logged in
if (window.Auth && window.Auth.user) {
  renderMyOwnedFromCache();
}
