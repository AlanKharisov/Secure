// ================== Config & helpers ==================
(function () {
  // Базовый URL бэкенда: берём из config.js или из текущего origin
  var API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || window.location.origin;

  // ====== Кто видит вкладку "Виробник" (whitelist) ======
  // Добавь сюда свои e-mail'ы брендов/производителей
  var MANUFACTURERS = new Set([
    "alankharisov1@gmail.com"
    // "brand2@example.com",
    // "brand3@example.com",
  ]);
  function isManufacturer() {
    var u = (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
    if (!u) return false;
    return MANUFACTURERS.has(u.trim().toLowerCase());
  }

  function $(s) { return document.querySelector(s); }
  function addQuery(url, params) {
    var u = new URL(url, window.location.origin);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    return u.toString();
  }
  function authUser() {
    var u = (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
    return (u || "").trim().toLowerCase();
  }
  function authHeaders() {
    var u = authUser();
    return u ? { "X-User": u } : {};
  }
  function isJsonContentType(ct) {
    if (!ct) return false;
    return ct.indexOf("application/json") !== -1;
  }
  async function apiJson(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, authHeaders(), (opts.headers || {}));
    var res = await fetch(API + path, Object.assign({}, opts, { headers: headers }));
    var ct = res.headers.get("content-type") || "";
    var data;
    if (isJsonContentType(ct)) {
      try { data = await res.json(); } catch (_) { data = {}; }
    } else {
      data = await res.text();
    }
    if (!res.ok) {
      var msg = isJsonContentType(ct) ? (data && data.error ? data.error : JSON.stringify(data)) : (typeof data === "string" ? data.slice(0, 400) : "HTTP error");
      throw new Error(msg);
    }
    return data;
  }

  // ================== Tabs ==================
  var tabBtns = document.querySelectorAll('.tab');
  for (var i = 0; i < tabBtns.length; i++) {
    (function(btn){
      btn.addEventListener('click', function(){
        var allTabs = document.querySelectorAll('.tab');
        var allPanes = document.querySelectorAll('.tabpane');
        for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove('active');
        for (var k = 0; k < allPanes.length; k++) allPanes[k].classList.remove('active');
        btn.classList.add('active');
        var pane = document.getElementById(btn.getAttribute('data-tab'));
        if (pane) pane.classList.add('active');

        if (btn.getAttribute('data-tab') === 'manufacturer') loadProducts();
        if (btn.getAttribute('data-tab') === 'user') renderMyOwnedFromCache();
      });
    })(tabBtns[i]);
  }

  // ================== QR ==================
  var publicQR = null;
  function getPublicQR() {
    var node = document.getElementById('publicQR');
    if (!node) return null;
    if (!publicQR) publicQR = new QRCode(node, { text: '', width: 180, height: 180 });
    return publicQR;
  }

  // ================== State ==================
  var MY_BRANDS = [];     // [{id,name,slug,verified,createdAt,...}]
  var _lastProducts = []; // кэш списка продуктов

  // ================== Brands ==================
  async function loadMyBrands(){
    if (!authUser()) { MY_BRANDS = []; renderBrandUI(); return; }
    try {
      // GET список брендов текущего юзера (бэкенд должен отдавать)
      var list = await apiJson("/api/manufacturers", { method: "GET" });
      MY_BRANDS = Array.isArray(list) ? list : [];
    } catch (e) {
      console.warn("loadMyBrands:", e.message);
      MY_BRANDS = [];
    }
    renderBrandUI();
  }

  function renderBrandUI(){
    var hasBrands = Array.isArray(MY_BRANDS) && MY_BRANDS.length > 0;

    // Вкладка «Виробник»: показываем если ты в whitelist ИЛИ у тебя есть бренды
    var manuTabBtn = document.querySelector('.tab[data-tab="manufacturer"]');
    var showManu = isManufacturer() || hasBrands;
    if (manuTabBtn) manuTabBtn.style.display = showManu ? "" : "none";

    // Бейджи брендов возле email
    var chips = document.getElementById("myBrands");
    if (chips) {
      if (!hasBrands) {
        chips.innerHTML = "";
      } else {
        var html = "";
        for (var i = 0; i < MY_BRANDS.length; i++) {
          var m = MY_BRANDS[i];
          html += '<span class="badge" title="'+(m.slug||'')+'">'+m.name+(m.verified?' ✅':'')+'</span>';
        }
        chips.innerHTML = html;
      }
    }

    // Селект бренда: если один — автоподставляем, НО поле не скрываем (чтоб можно было сменить при необходимости)
    var sel = document.getElementById("brand");
    var field = document.getElementById("brandField");
    var hint = document.getElementById("brandHint");
    if (sel) {
      if (!hasBrands) {
        sel.innerHTML = '<option value="">— у вас немає брендів —</option>';
        if (field) field.style.display = '';
        if (hint) hint.style.display = 'none';
      } else if (MY_BRANDS.length === 1) {
        var b = MY_BRANDS[0];
        sel.innerHTML = '<option value="'+b.slug+'" selected>'+b.name+(b.verified?' ✅':'')+'</option>';
        sel.value = b.slug;
        if (field) field.style.display = '';
        if (hint) hint.style.display = '';
      } else {
        var opts = '<option value="">— оберіть бренд —</option>';
        for (var j = 0; j < MY_BRANDS.length; j++) {
          var mb = MY_BRANDS[j];
          opts += '<option value="'+mb.slug+'">'+mb.name+(mb.verified?' ✅':'')+'</option>';
        }
        sel.innerHTML = opts;
        if (field) field.style.display = '';
        if (hint) hint.style.display = 'none';
      }
    }
  }

  // ================== Create Product(s) ==================
  var createForm = $('#createForm');
  var createdBlock = $('#createdBlock');
  var lastCreatedUrl = '';

  if (createForm) {
    createForm.addEventListener('submit', function(e){
      e.preventDefault();

      if (!authUser()){ alert('Увійдіть, будь ласка.'); return; }

      var fd = new FormData(createForm);
      var name = String(fd.get('name') || '').trim();
      var brand = String(fd.get('brand') || '').trim();
      var manufacturedAt = String(fd.get('manufacturedAt') || '').trim(); // опц.
      var image = String(fd.get('image') || '').trim();                   // опц.
      var editionCountRaw = fd.get('editionCount');
      var editionCount = Number(editionCountRaw != null ? editionCountRaw : 1);

      if (!name){ alert('Введіть назву'); return; }
      if (!brand && MY_BRANDS.length === 1) brand = MY_BRANDS[0].slug;
      if (MY_BRANDS.length > 0 && !brand){ alert('Оберіть бренд'); return; }

      if (!isFinite(editionCount) || editionCount < 1) editionCount = 1;

      var payload = {
        name: name,
        brand: brand,
        manufacturedAt: manufacturedAt,
        image: image,
        editionCount: editionCount
      };

      (async function(){
        try {
          var j = await apiJson("/api/manufacturer/products", {
            method: "POST",
            body: JSON.stringify(payload)
          });

          // Бэкенд может вернуть 1 продукт или объект {created: []}
          var list = (j && j.created && Array.isArray(j.created)) ? j.created : [j];

          if (createdBlock) createdBlock.classList.remove('hidden');

          var first = list[0];
          var baseUrl = first.publicUrl || (API + "/details.html?id=" + first.id);
          var url = addQuery(baseUrl, { s: first.serialHash });
          lastCreatedUrl = url;

          var createdId = $('#createdId');
          if (createdId) createdId.textContent = (list.length === 1) ? String(first.id) : (String(list.length) + " шт. (партія)");
          var createdState = $('#createdState');
          if (createdState) createdState.textContent = first.state || '';
          var createdUrl = $('#createdUrl');
          if (createdUrl) createdUrl.textContent = url;

          var qr = getPublicQR();
          if (qr) { qr.clear(); qr.makeCode(url); }

          await loadProducts();
          renderMyOwnedFromCache();
          createForm.reset();
        } catch (err) {
          alert(err.message || 'Помилка створення');
        }
      })();
    });
  }

  var dlQR = $('#downloadQR');
  if (dlQR) {
    dlQR.addEventListener('click', function(){
      var node = document.querySelector('#publicQR canvas') || document.querySelector('#publicQR img');
      if (!node) { alert('QR ще не згенерований'); return; }
      var dataURL = '';
      if (node.tagName && node.tagName.toLowerCase() === 'canvas') dataURL = node.toDataURL('image/png');
      else dataURL = node.src || '';
      if (!dataURL) { alert('Не вдалося отримати QR'); return; }

      var a = document.createElement('a');
      a.href = dataURL;
      a.download = 'qr.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  var copyUrlBtn = $('#copyUrl');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', function(){
      if (!lastCreatedUrl) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastCreatedUrl).then(function(){
          alert('Посилання скопійовано');
        }, function(){
          alert('Не вдалося скопіювати');
        });
      } else {
        alert('Clipboard API недоступний');
      }
    });
  }

  // ================== Tables ==================
  var tbody = $('#productsBody'); // виробник
  var myBody = $('#myBody');      // користувач

  async function loadProducts() {
    if (!tbody) return;

    if (!authUser()) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Увійдіть</td></tr>';
      if (myBody) myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть</td></tr>';
      return;
    }

    tbody.innerHTML = '<tr><td colspan="7" class="muted">Завантаження…</td></tr>';
    try {
      var list = await apiJson("/api/products", { method:"GET" });
      _lastProducts = Array.isArray(list) ? list.slice() : [];

      // Показываем в производственной таблице:
      // - owner == я (всегда)
      // - seller == я && state == 'created' (ещё не продано)
      var me = authUser();
      var display = [];
      for (var i = 0; i < _lastProducts.length; i++) {
        var p = _lastProducts[i];
        var owner = (p.owner || '').toLowerCase() === me;
        var unsoldAsSeller = (p.seller || '').toLowerCase() === me && String(p.state).toLowerCase() === 'created';
        if (owner || unsoldAsSeller) display.push(p);
      }

      if (!display.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>';
      } else {
        tbody.innerHTML = '';
        for (var d = 0; d < display.length; d++) {
          var prod = display[d];
          var detailsUrl = addQuery('details.html?id=' + prod.id, { s: prod.serialHash });
          var ed = (prod.editionTotal && prod.editionTotal > 1) ? (prod.editionNo + '/' + prod.editionTotal) : '-';
          var tr = document.createElement('tr');
          tr.innerHTML = ''
            + '<td class="mono">' + prod.id + '</td>'
            + '<td>' + ((prod.meta && prod.meta.name) || '') + '</td>'
            + '<td class="mono">' + ((prod.meta && prod.meta.serial) || '') + '</td>'
            + '<td class="mono">' + ed + '</td>'
            + '<td>' + (prod.brand || '-') + '</td>'
            + '<td><span class="badge">' + prod.state + '</span></td>'
            + '<td><a class="btn" href="' + detailsUrl + '" target="_blank" rel="noopener">Деталі</a></td>';
          tbody.appendChild(tr);
        }
      }

      renderMyOwnedFromCache();
    } catch (e) {
      console.error('loadProducts error:', e);
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Помилка завантаження: ' + e.message + '</td></tr>';
    }
  }

  function renderMyOwnedFromCache() {
    if (!myBody) return;
    var me = authUser();
    if (!me) {
      myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>';
      return;
    }

    var mine = [];
    for (var i = 0; i < _lastProducts.length; i++) {
      var p = _lastProducts[i];
      if ((p.owner || '').toLowerCase() === me) mine.push(p);
    }

    myBody.innerHTML = '';
    if (!mine.length) {
      myBody.innerHTML = '<tr><td colspan="6" class="muted">Ще немає товарів</td></tr>';
      return;
    }

    for (var m = 0; m < mine.length; m++) {
      var pdt = mine[m];
      var imgHtml = (pdt.meta && pdt.meta.image && pdt.meta.image.trim()) ? '<img class="thumb" src="' + pdt.meta.image + '" alt="">' : '';
      var detailsUrl = addQuery('details.html?id=' + encodeURIComponent(pdt.id), { s: pdt.serialHash || '' });
      var tr = document.createElement('tr');
      tr.innerHTML = ''
        + '<td>' + imgHtml + '</td>'
        + '<td>' + ((pdt.meta && pdt.meta.name) || '-') + '</td>'
        + '<td class="mono">' + ((pdt.meta && pdt.meta.serial) || '-') + '</td>'
        + '<td class="mono">' + pdt.id + '</td>'
        + '<td><span class="badge">' + pdt.state + '</span></td>'
        + '<td><a class="btn" href="' + detailsUrl + '" target="_blank" rel="noopener">Відкрити</a></td>';
      myBody.appendChild(tr);
    }
  }

  // ================== Bootstrap on auth ==================
  document.addEventListener('auth-changed', function () {
    if (authUser()) {
      loadMyBrands();
      loadProducts();
      renderMyOwnedFromCache();
    } else {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="muted">Увійдіть</td></tr>';
      if (myBody) myBody.innerHTML = '<tr><td colspan="6" class="muted">Увійдіть</td></tr>';
      MY_BRANDS = [];
      renderBrandUI();
    }
  });

  // если уже авторизован до загрузки страницы
  if (window.Auth && window.Auth.user) {
    loadMyBrands();
    loadProducts();
    renderMyOwnedFromCache();
  }

  // Кнопка “Відкрити деталі” (ручной ввод id)
  var openDetails = $('#openDetails');
  if (openDetails) {
    openDetails.addEventListener('click', function(){
      var input = $('#manualId');
      var idIn = (input && input.value) ? String(input.value).trim() : '';
      if (!idIn) return;
      location.href = 'details.html?id=' + encodeURIComponent(idIn);
    });
  }

  // Кошик бейдж
  (function () {
    var badge = document.getElementById('cartCount');
    if (!window.MCart || !badge) return;
    window.MCart.updateBadge();
  })();

})();
