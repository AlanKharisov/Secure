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
function fetchJSON(url, opts, expectJson) {
  if (opts === void 0) opts = {};
  if (expectJson === void 0) expectJson = true;
  return fetch(url, opts).then(function(res){
    if (!res.ok) return res.text().then(function(t){ throw new Error(t || ("HTTP " + res.status)); });
    if (!expectJson) return null;
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.indexOf("application/json") === -1) return null;
    return res.json();
  });
}

// ===== Manufacturer form (створення продуктів) =====
var createForm = $("#createForm");
var createdBlock = $("#createdBlock");
var lastCreatedUrl = "";
var brandSelect = $("#brandSelect"); // може бути відсутній

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
    if (!authUser()) { alert("Увійдіть"); return; }

    var fd = new FormData(createForm);
    var name = (fd.get("name") || "").toString().trim();
    var mfg  = (fd.get("mfg") || "").toString().trim();
    var image= (fd.get("image") || "").toString().trim();
    var edStr= (fd.get("edition") || "1").toString().trim();
    var edition = Math.max(1, parseInt(edStr, 10) || 1);

    if (!name) { alert("Назва обовʼязкова"); return; }

    // Бекенд сам визначить бренд за X-User (для адміна можна додати X-Brand заголовком)
    var body = { name: name, quantity: edition };
    if (mfg) body.manufacturedAt = mfg;
    if (image) body.image = image;

    fetchJSON(API + "/api/products", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function(resp){
      var created = Array.isArray(resp.created) ? resp.created : (Array.isArray(resp) ? resp : []);
      var item = created[0] || resp;
      if (!item || !item.id) throw new Error("Unexpected response");
      lastCreatedUrl = item.publicUrl || (API + "/details.html?id=" + item.id);
      if (createdBlock) createdBlock.classList.remove("hidden");
      var el1 = $("#createdId");    if (el1) el1.textContent = String(item.id);
      var el2 = $("#createdState"); if (el2) el2.textContent = item.state || "created";
      var el3 = $("#createdUrl");   if (el3) el3.textContent = lastCreatedUrl;

      // QR (тільки якщо є бібліотека QRCode і контейнер)
      var qrWrap = document.getElementById("publicQR");
      if (qrWrap && window.QRCode) {
        qrWrap.innerHTML = "";
        new QRCode(qrWrap, { text: lastCreatedUrl, width: 180, height: 180 });
      }

      loadManufacturerProducts();
      createForm.reset();
    }).catch(function(err){ alert(err.message); });
  });
}

// ===== Завантаження таблиць (manufacturer/admin) =====
var manufBody = $("#productsBody");
var allBody   = $("#allBody");
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
        return;
      }
      manufBody.innerHTML = "";
      _lastProducts.forEach(function(p){
        var detailsUrl = "details.html?id=" + encodeURIComponent(p.id);
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

  fetchJSON(API + "/api/products", { headers: authHeaders() })
    .then(function(list){
      if (!Array.isArray(list) || !list.length) {
        allBody.innerHTML = '<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>';
        return;
      }
      allBody.innerHTML = "";
      list.forEach(function(p){
        var detailsUrl = "details.html?id=" + encodeURIComponent(p.id);
        var brand = p.brandSlug || "";
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

// ===== API keys =====
var createdKeyBox = $("#createdKeyBox");
var createdKeyValue = $("#createdKeyValue");
var ingestUrlInput = $("#ingestUrl");
var copyIngestBtn = $("#copyIngest");
var createKeyBtn = $("#createKey");
var keysBody = $("#keysBody");

function primaryBrandSlug() {
  var b = (window.LAST_ROLES && window.LAST_ROLES.brands) ? window.LAST_ROLES.brands[0] : null;
  return b ? b.slug : "";
}
function syncIngestUI() {
  if (!ingestUrlInput) return;
  var slug = primaryBrandSlug();
  ingestUrlInput.value = slug ? (API + "/api/integrations/ingest") : "";
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

// Ролі з auth-ui.js
document.addEventListener("roles-ready", function(e){
  window.LAST_ROLES = e.detail || {};
  fillBrandSelect(window.LAST_ROLES.brands || []);
  syncIngestUI();
  if (window.LAST_ROLES.isManufacturer) loadManufacturerProducts();
  if (window.LAST_ROLES.isAdmin) loadAllProducts();
});
