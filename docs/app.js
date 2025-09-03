// ---------- Config & helpers ----------
const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || window.location.origin;

function $(s){ return document.querySelector(s); }

function addQuery(url, params) {
  const u = new URL(url, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  return u.toString();
}

function authUser(){
  const u = (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
  return (u || "").trim().toLowerCase();
}
function authHeaders(){
  const u = authUser();
  return u ? { "X-User": u } : {};
}

async function apiJson(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers || {}) },
    ...opts
  });
  const ct = res.headers.get("content-type") || "";
  const isJSON = ct.includes("application/json");
  const data = isJSON ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = isJSON ? (data.error || JSON.stringify(data)) : (typeof data === "string" ? data.slice(0, 500) : "HTTP error");
    throw new Error(msg);
  }
  return data;
}

// ---------- Tabs ----------
(function setupTabs(){
  const tabs = document.querySelectorAll('.tab');
  const panes = document.querySelectorAll('.tabpane');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(btn.dataset.tab);
      if (pane) pane.classList.add('active');

      if (btn.dataset.tab === 'manufacturer') loadProducts();
      if (btn.dataset.tab === 'user') renderMyOwnedFromCache();
    });
  });
})();

// ---------- Lazy QR instance ----------
let publicQR = null;
function getPublicQR() {
  const node = document.getElementById('publicQR');
  if (!node) return null;
  if (!publicQR) publicQR = new QRCode(node, { text: '', width: 180, height: 180 });
  return publicQR;
}

// ---------- Brand handling ----------
let MY_BRANDS = [];     // [{id,name,slug,verified,...}]
let _lastProducts = []; // кэш списка для быстрого рендера

async function loadMyBrands(){
  if (!authUser()) { MY_BRANDS = []; renderBrandUI(); return; }
  try{
    const list = await apiJson("/api/manufacturers", { method: "GET" });
    MY_BRANDS = Array.isArray(list) ? list : [];
    renderBrandUI();
  }catch(e){
    console.warn("loadMyBrands:", e.message);
    MY_BRANDS = [];
    renderBrandUI();
  }
}

function renderBrandUI(){
  const hasBrands = MY_BRANDS.length > 0;

  // Показать/спрятать вкладку «Виробник»
  const manuTabBtn = document.querySelector('.tab[data-tab="manufacturer"]');
  const manuPane = document.getElementById('manufacturer');
  if (manuTabBtn) manuTabBtn.style.display = hasBrands ? "" : "none";
  if (manuPane && !hasBrands) {
    if (manuPane.classList.contains('active')) {
      const userBtn = document.querySelector('.tab[data-tab="user"]');
      if (userBtn) userBtn.click();
    }
  }

  // Селект бренда в форме
  const sel = document.getElementById("brand");
  if (sel) {
    sel.innerHTML = `<option value="">— оберіть бренд —</option>` +
      MY_BRANDS.map(b => `<option value="${b.slug}">${b.name}${b.verified ? " ✅" : ""}</option>`).join("");
  }

  // Бейджики брендов в хедере
  const box = document.getElementById("myBrands");
  if (box) {
    if (MY_BRANDS.length === 0) {
      box.innerHTML = `<span class="muted">Немає брендів</span>`;
    } else {
      box.innerHTML = MY_BRANDS.map(m =>
        `<span class="badge" title="${m.slug}">${m.name}${m.verified ? " ✅" : ""}</span>`
      ).join(" ");
    }
  }
}

// ---------- Create Product(s) ----------
const createForm = $('#createForm');
const createdBlock = $('#createdBlock');
let lastCreatedUrl = '';

if (createForm){
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fd = new FormData(createForm);
    const name = String(fd.get('name') || '').trim();
    const brand = String(fd.get('brand') || '').trim();
    const manufacturedAt = String(fd.get('manufacturedAt') || '').trim();
    const image = String(fd.get('image') || '').trim();
    const editionCount = Number(fd.get('editionCount') || 1);

    if (!authUser()){ alert('Увійдіть, будь ласка.'); return; }
    if (!name){ alert('Введіть назву'); return; }
    if (MY_BRANDS.length > 0 && !brand){ alert('Оберіть бренд'); return; }

    const payload = {
      name,
      brand,
      manufacturedAt,
      image,
      editionCount: (isFinite(editionCount) && editionCount > 0) ? editionCount : 1
    };

    try{
      const j = await apiJson("/api/manufacturer/products", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      // Поддержка party и одиночного ответа
      const list = Array.isArray(j?.created) ? j.created : [j];

      // Показать блок "Создано"
      if (createdBlock) createdBlock.classList.remove('hidden');

      const first = list[0];
      const baseUrl = first.publicUrl || `${API}/details.html?id=${first.id}`;
      const url = addQuery(baseUrl, { s: first.serialHash });
      lastCreatedUrl = url;

      const idLabel = list.length === 1 ? String(first.id) : `${list.length} шт. (партія)`;
      const stateLabel = first.state || '';

      const idEl = document.getElementById('createdId');
      const stateEl = document.getElementById('createdState');
      const urlEl = document.getElementById('createdUrl');
      if (idEl) idEl.textContent = idLabel;
      if (stateEl) stateEl.textContent = stateLabel;
      if (urlEl) urlEl.textContent = url;

      const qr = getPublicQR();
      if (qr) { qr.clear(); qr.makeCode(url); }

      await loadProducts();
      renderMyOwnedFromCache();
      createForm.reset();

    }catch(err){
      alert(err.message || 'Помилка створення');
    }
  });
}

// Download QR (PNG)
const dlBtn = document.getElementById('downloadQR');
if (dlBtn){
  dlBtn.addEventListener('click', () => {
    const node = document.querySelector('#publicQR canvas') || document.querySelector('#publicQR img');
    if (!node) { alert('QR ще не згенерований'); return; }
    let dataURL = '';
    if (node.tagName && node.tagName.toLowerCase() === 'canvas') dataURL = node.toDataURL('image/png');
    else dataURL = node.src || '';
    if (!dataURL) { alert('Не вдалося отримати QR'); return; }

    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'qr.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// Copy URL
const copyBtn = document.getElementById('copyUrl');
if (copyBtn){
  copyBtn.addEventListener('click', async () => {
    if (!lastCreatedUrl) return;
    try {
      await navigator.clipboard.writeText(lastCreatedUrl);
      alert('Посилання скопійовано');
    } catch {
      alert('Не вдалося скопіювати');
    }
  });
}

// ---------- Tables ----------
const tbody = $('#productsBody'); // виробник (всі мої як owner/seller)
const myBody = $('#myBody');      // користувач (тільки мої як owner)

async function loadProducts() {
  if (!tbody) return;

  if (!authUser()) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Увійдіть</td></tr>`;
    if (myBody) myBody.innerHTML = `<tr><td colspan="6" class="muted">Увійдіть</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="7" class="muted">Завантаження…</td></tr>`;
  try{
    const list = await apiJson("/api/products", { method:"GET" });

    if (!Array.isArray(list) || !list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Ще немає продуктів</td></tr>`;
      _lastProducts = [];
      renderMyOwnedFromCache();
      return;
    }

    _lastProducts = list.slice();

    tbody.innerHTML = '';
    list.forEach((p) => {
      const detailsUrl = addQuery(`details.html?id=${p.id}`, { s: p.serialHash });
      const ed = (p.editionTotal && p.editionTotal > 1) ? `${p.editionNo}/${p.editionTotal}` : '-';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${p.id}</td>
        <td>${(p.meta && p.meta.name) || ''}</td>
        <td class="mono">${(p.meta && p.meta.serial) || ''}</td>
        <td class="mono">${ed}</td>
        <td>${p.brand || '-'}</td>
        <td><span class="badge">${p.state}</span></td>
        <td>
          <a class="btn" href="${detailsUrl}" target="_blank" rel="noopener">Деталі</a>
        </td>`;
      tbody.appendChild(tr);
    });

    renderMyOwnedFromCache();
  }catch(e){
    console.error('loadProducts error:', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Помилка завантаження: ${e.message}</td></tr>`;
  }
}

function renderMyOwnedFromCache() {
  if (!myBody) return;
  const me = authUser();
  if (!me) {
    myBody.innerHTML = `<tr><td colspan="6" class="muted">Увійдіть, щоб побачити свої товари</td></tr>`;
    return;
  }

  const mine = _lastProducts.filter((p) => (p.owner || '').toLowerCase() === me);
  myBody.innerHTML = '';
  if (!mine.length) {
    myBody.innerHTML = `<tr><td colspan="6" class="muted">Ще немає товарів</td></tr>`;
    return;
  }

  mine.forEach((pdt) => {
    const img = (pdt.meta && pdt.meta.image && pdt.meta.image.trim()) ? `<img class="thumb" src="${pdt.meta.image}" alt="">` : '';
    const detailsUrl = addQuery(`details.html?id=${encodeURIComponent(pdt.id)}`, { s: pdt.serialHash || '' });
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${img}</td>
      <td>${(pdt.meta && pdt.meta.name) || '-'}</td>
      <td class="mono">${(pdt.meta && pdt.meta.serial) || '-'}</td>
      <td class="mono">${pdt.id}</td>
      <td><span class="badge">${pdt.state}</span></td>
      <td><a class="btn" href="${detailsUrl}" target="_blank" rel="noopener">Відкрити</a></td>`;
    myBody.appendChild(tr);
  });
}

// ---------- Misc ----------
document.addEventListener('auth-changed', () => {
  if (authUser()) {
    loadMyBrands().then(() => {
      loadProducts();
      renderMyOwnedFromCache();
    });
  } else {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="muted">Увійдіть</td></tr>`;
    if (myBody) myBody.innerHTML = `<tr><td colspan="6" class="muted">Увійдіть</td></tr>`;
    MY_BRANDS = [];
    renderBrandUI();
  }
});

// если уже авторизован до загрузки страницы
if (window.Auth && window.Auth.user) {
  loadMyBrands().then(() => {
    loadProducts();
    renderMyOwnedFromCache();
  });
}

// Кнопка “Відкрити деталі” (ручной ввод)
const openBtn = document.getElementById('openDetails');
if (openBtn){
  openBtn.addEventListener('click', () => {
    const id = ($('#manualId') && $('#manualId').value || '').trim();
    if (!id) return;
    location.href = `details.html?id=${encodeURIComponent(id)}`;
  });
}

// Обновить бейдж корзины при загрузке
(function () {
  if (!window.MCart || !document.getElementById('cartCount')) return;
  window.MCart.updateBadge();
})();

