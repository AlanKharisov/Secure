(function(){
  "use strict";

  var API = window.API_BASE || window.location.origin;

  function $(s, sc){ return (sc||document).querySelector(s); }
  function esc(s){ return (s==null?"":String(s)).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function authUser(){ return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
  function authHeaders(){ var u = authUser(); return u ? { "X-User": u } : {}; }
  function addQuery(url, params){
    var u = new URL(url, window.location.origin);
    Object.keys(params||{}).forEach(function(k){
      var v = params[k];
      if (v!==undefined && v!==null) u.searchParams.set(k, String(v));
    });
    return u.toString();
  }
  function fetchJSON(url, opts){
    return fetch(url, opts||{}).then(async function(res){
      var ct = (res.headers.get("content-type")||"").toLowerCase();
      var body = ct.includes("application/json") ? await res.json() : await res.text();
      return { ok: res.ok, data: body };
    });
  }

  // ---------- Tabs ----------
  var tabButtons = document.querySelectorAll(".tab");
  tabButtons.forEach(function(btn){
    btn.addEventListener("click", function(){
      document.querySelectorAll(".tab").forEach(function(b){ b.classList.remove("active"); });
      document.querySelectorAll(".tabpane").forEach(function(p){ p.classList.remove("active"); });
      btn.classList.add("active");
      var pane = $("#"+btn.dataset.tab);
      if (pane) pane.classList.add("active");

      var tab = btn.dataset.tab;
      if (tab === "manufacturer") loadManufacturerProducts();
      if (tab === "admin") loadAllProducts();
      if (tab === "user") ensureMyProducts();
    });
  });

  // ---------- Roles ----------
  var CURRENT_ROLES = { email:"", isAdmin:false, isManufacturer:false, brands:[] };
  document.addEventListener("roles-ready", function(e){
    CURRENT_ROLES = e.detail || CURRENT_ROLES;

    // підсвітити вкладки відповідно до ролей (дубль на всяк)
    var adminTab = $("#adminTab");
    var manufTab = $("#manufTab");
    if (adminTab) adminTab.style.display = CURRENT_ROLES.isAdmin ? "" : "none";
    if (manufTab) manufTab.style.display = CURRENT_ROLES.isManufacturer ? "" : "none";

    // оновити списки
    if (CURRENT_ROLES.isManufacturer) loadManufacturerProducts();
    if (CURRENT_ROLES.isAdmin) loadAllProducts();
    ensureMyProducts();
  });

  // ---------- Lazy QR ----------
  var publicQR = null;
  function getPublicQR(){
    var node = $("#publicQR");
    if (!node) return null;
    if (!publicQR) publicQR = new QRCode(node, { text:"", width:180, height:180 });
    return publicQR;
  }

  // ---------- Create form ----------
  var createForm = $("#createForm");
  var createdBlock = $("#createdBlock");
  var lastCreatedUrl = "";

  if (createForm){
    createForm.addEventListener("submit", function(e){
      e.preventDefault();

      var fd = new FormData(createForm);
      var name = (fd.get("name") || "").toString().trim();
      var mfg  = (fd.get("mfg")  || "").toString().trim();
      var image= (fd.get("image")|| "").toString().trim();
      var edStr= (fd.get("edition") || "1").toString().trim();
      var edition = Math.max(1, parseInt(edStr,10) || 1);

      if (!authUser()){ alert("Увійдіть"); return; }

      // дозволяємо створення виробнику АБО адміна
      if (!CURRENT_ROLES.isManufacturer && !CURRENT_ROLES.isAdmin){
        alert("Недостатньо прав: потрібен бренд або роль адміна");
        return;
      }
      if (!name){ alert("Назва обовʼязкова"); return; }

      var primaryBrand = (CURRENT_ROLES.brands && CURRENT_ROLES.brands[0]) ? CURRENT_ROLES.brands[0].slug : "";
      if (!primaryBrand){
        // адмін без бренду — не даємо створювати (можна доробити поле "brand" окремо)
        alert("У вас немає бренду. Зверніться до адміна, щоб додати бренд.");
        return;
      }

      var payload = { name: name, brand: primaryBrand };
      if (mfg)   payload.manufacturedAt = mfg;
      if (image) payload.image = image;
      if (edition && edition>1) payload.edition = edition;

      fetch(API + "/api/manufacturer/products", {
        method: "POST",
        headers: Object.assign({ "Content-Type":"application/json" }, authHeaders()),
        body: JSON.stringify(payload)
      })
      .then(function(res){ return res.json().then(function(j){ return { ok:res.ok, data:j }; }); })
      .then(function(r){
        if (!r.ok) throw new Error(r.data && r.data.error || "Create failed");

        var p = r.data;
        var baseUrl = p.publicUrl || (API + "/details.html?id=" + p.id);
        var url = addQuery(baseUrl, { s: p.serialHash || "" });
        lastCreatedUrl = url;

        if (createdBlock) createdBlock.classList.remove("hidden");
        var a = $("#createdId");    if (a) a.textContent = p.id;
        var b = $("#createdState"); if (b) b.textContent = p.state;
        var c = $("#createdUrl");   if (c) c.textContent = url;

        var qr = getPublicQR();
        if (qr){ qr.clear(); qr.makeCode(url); }

        loadManufacturerProducts();
        ensureMyProducts();
        createForm.reset();
      })
      .catch(function(err){ alert(err.message); });
    });
  }

  // Download QR
  var dlBtn = $("#downloadQR");
  if (dlBtn){
    dlBtn.addEventListener("click", function(){
      var node = document.querySelector("#publicQR canvas") || document.querySelector("#publicQR img");
      if (!node){ alert("QR ще не згенерований"); return; }
      var dataURL = (node.tagName.toLowerCase()==="canvas") ? node.toDataURL("image/png") : (node.src || "");
      if (!dataURL){ alert("Не вдалося отримати QR"); return; }
      var a = document.createElement("a");
      a.href = dataURL; a.download = "qr.png";
      document.body.appendChild(a); a.click(); a.remove();
    });
  }

  // Copy URL
  var copyBtn = $("#copyUrl");
  if (copyBtn){
    copyBtn.addEventListener("click", function(){
      if (!lastCreatedUrl) return;
      if (navigator.clipboard && navigator.clipboard.writeText){
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

  // ---------- Tables ----------
  var manufBody = $("#productsBody"); // виробник
  var allBody   = $("#allBody");      // адмін
  var myBody    = $("#myBody");       // користувач/акаунт

  var _lastProducts = [];

  function loadManufacturerProducts(){
    if (!manufBody) return;
    if (!authUser()){
      manufBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть</td></tr>';
      return;
    }
    manufBody.innerHTML = '<tr><td colspan="6" class="muted">Завантаження…</td></tr>';

    fetch(API + "/api/products", { headers: authHeaders() })
      .then(res=>res.json())
      .then(function(list){
        _lastProducts = Array.isArray(list) ? list : [];
        if (!_lastProducts.length){
          manufBody.innerHTML = '<tr><td colspan="6" class="muted">Ще немає продуктів</td></tr>';
          ensureMyProducts();
          return;
        }
        manufBody.innerHTML = "";
        _lastProducts.forEach(function(p){
          var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(p.id), { s: p.serialHash || "" });
          var tr = document.createElement("tr");
          tr.innerHTML =
            '<td>'+ p.id +'</td>'+
            '<td>'+ esc(p.meta && p.meta.name || "") +'</td>'+
            '<td class="mono">'+ esc(p.meta && p.meta.serial || "") +'</td>'+
            '<td class="mono">'+ esc((p.meta && p.meta.edition) || "1") +'</td>'+
            '<td><span class="badge">'+ esc(p.state) +'</span></td>'+
            '<td>'+
              '<a class="btn" href="'+ detailsUrl +'" target="_blank" rel="noopener">Деталі</a> '+
              (p.state==="created" ? '<button class="btn" data-buy="'+ p.id +'">Позначити купленим (передати мені)</button>' : '')+
            '</td>';
          manufBody.appendChild(tr);
        });

        manufBody.querySelectorAll("[data-buy]").forEach(function(btn){
          btn.addEventListener("click", function(){
            var id = btn.getAttribute("data-buy");
            markPurchased(id);
          });
        });

        ensureMyProducts();
      })
      .catch(function(e){
        console.error("loadManufacturerProducts:", e);
        manufBody.innerHTML = '<tr><td colspan="6" class="muted">Помилка завантаження</td></tr>';
      });
  }

  function loadAllProducts(){
    if (!allBody) return;
    if (!authUser()){
      allBody.innerHTML = '<tr><td colspan="7" class="muted">Увійдіть</td></tr>';
      return;
    }
    allBody.innerHTML = '<tr><td colspan="7" class="muted">Завантаження…</td></tr>';

    fetch(API + "/api/products?all=1", { headers: authHeaders() })
      .then(res=>res.json())
      .then(function(list){
        if (!Array.isArray(list) || !list.length){
          allBody.innerHTML = '<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>';
          return;
        }
        allBody.innerHTML = "";
        list.forEach(function(p){
          var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(p.id), { s: p.serialHash || "" });
          var brand = (p.meta && (p.meta.brand || p.brand)) || "";
          var tr = document.createElement("tr");
          tr.innerHTML =
            '<td>'+ p.id +'</td>'+
            '<td>'+ esc(p.meta && p.meta.name || "") +'</td>'+
            '<td class="mono">'+ esc(p.meta && p.meta.serial || "") +'</td>'+
            '<td class="mono">'+ esc((p.meta && p.meta.edition) || "1") +'</td>'+
            '<td>'+ esc(brand) +'</td>'+
            '<td><span class="badge">'+ esc(p.state) +'</span></td>'+
            '<td><a class="btn" href="'+ detailsUrl +'" target="_blank" rel="noopener">Деталі</a></td>';
          allBody.appendChild(tr);
        });
      })
      .catch(function(e){
        console.error("loadAllProducts:", e);
        allBody.innerHTML = '<tr><td colspan="7" class="muted">Помилка завантаження</td></tr>';
      });
  }

  function ensureMyProducts(){
    // Якщо на сторінці є секція "Мої товари" — завантажимо дані (на index і на account)
    if (!myBody) return;
    if (!authUser()){
      myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>';
      return;
    }
    // Якщо вже є кеш — відрендеримо з кешу, і паралельно оновимо
    if (_lastProducts.length) renderMyOwnedFromCache();

    // підвантажимо свіжі (для себе бек повертає owner/seller свої)
    fetch(API + "/api/products", { headers: authHeaders() })
      .then(res=>res.json())
      .then(function(list){
        if (Array.isArray(list)) _lastProducts = list;
        renderMyOwnedFromCache();
      })
      .catch(function(){
        if (!myBody.innerHTML.trim()){
          myBody.innerHTML = '<tr><td colspan="6" class="muted">Помилка завантаження</td></tr>';
        }
      });
  }

  function renderMyOwnedFromCache(){
    if (!myBody) return;
    var me = authUser();
    if (!me){
      myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>';
      return;
    }
    var mine = _lastProducts.filter(function(p){ return (p.owner||"").toLowerCase() === me.toLowerCase(); });
    myBody.innerHTML = "";
    if (!mine.length){
      myBody.innerHTML = '<tr><td colspan="6" class="muted">Ще немає товарів</td></tr>';
      // reset KPI
      var kp1 = $("#kPurchased"); if (kp1) kp1.textContent = "0";
      var kp2 = $("#kCreated");   if (kp2) kp2.textContent = "0";
      var kp3 = $("#kClaimed");   if (kp3) kp3.textContent = "0";
      return;
    }
    var pCnt=0, cCnt=0, clCnt=0;
    mine.forEach(function(pdt){
      if (pdt.state==="purchased") pCnt++;
      else if (pdt.state==="created") cCnt++;
      else if (pdt.state==="claimed") clCnt++;
      var img = (pdt.meta && pdt.meta.image || "").trim() ? '<img class="thumb" src="'+ esc(pdt.meta.image) +'" alt="">' : "";
      var detailsUrl = addQuery("details.html?id=" + encodeURIComponent(pdt.id), { s: pdt.serialHash || "" });
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>'+ img +'</td>'+
        '<td>'+ esc(pdt.meta && pdt.meta.name || "-") +'</td>'+
        '<td class="mono">'+ esc(pdt.meta && pdt.meta.serial || "-") +'</td>'+
        '<td class="mono">'+ pdt.id +'</td>'+
        '<td><span class="badge">'+ esc(pdt.state) +'</span></td>'+
        '<td><a class="btn" href="'+ detailsUrl +'" target="_blank" rel="noopener">Відкрити</a></td>';
      myBody.appendChild(tr);
    });
    var kp1 = $("#kPurchased"); if (kp1) kp1.textContent = String(pCnt);
    var kp2 = $("#kCreated");   if (kp2) kp2.textContent = String(cCnt);
    var kp3 = $("#kClaimed");   if (kp3) kp3.textContent = String(clCnt);
  }

  function markPurchased(id){
    if (!authUser()){ alert("Будь ласка, увійдіть у свій акаунт."); return; }
    fetch(API + "/api/products/" + encodeURIComponent(id) + "/purchase", {
      method: "POST",
      headers: Object.assign({ "Content-Type":"application/json" }, authHeaders()),
      body: "{}"
    })
    .then(res=>res.json().then(j=>({ ok:res.ok, data:j })))
    .then(function(r){
      if (!r.ok) throw new Error(r.data && r.data.error || "Failed");
      loadManufacturerProducts();
      ensureMyProducts();
      alert("Власність передано вам");
    })
    .catch(function(e){ alert(e.message); });
  }

  // зробимо доступною для інших частин (раптом треба)
  window._markPurchased = markPurchased;

  // старт: якщо вже авторизований — підтягнемо "мої товари"
  if (window.Auth && window.Auth.user){
    ensureMyProducts();
  }
})();

