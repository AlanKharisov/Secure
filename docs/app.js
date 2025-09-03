// ---------- Config & helpers ----------
const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || window.location.origin;
const $ = (s) => document.querySelector(s);

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
function authHeaders(){ const u = authUser(); return u ? { "X-User": u } : {}; }

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
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const pane = document.getElementById(btn.dataset.tab);
    if (pane) pane.classList.add('active');

    if (btn.dataset.tab === 'manufacturer') loadProducts();
    if (btn.dataset.tab === 'user') renderMyOwnedFromCache();
  });
});

// ---------- Lazy QR ----------
let publicQR = null;
function getPublicQR() {
  const node = document.getElementById('publicQR');
  if (!node) return null;
  if (!publicQR) publicQR = new QRCode(node, { text: '', width: 180, height: 180 });
  return publicQR;
}

// ---------- Brands ----------
let MY_BRANDS = [];     // [{id,name,slug,verified,...}]
let _lastProducts = []; // cache

async function loadMyBrands(){
  if (!authUser()) { MY_BRANDS = []; renderBrandUI(); return; }
  try{
    const list = await apiJson("/api/manufacturers", { method: "GET" });
    MY_BRANDS = Array.isArray(list) ? list : [];
  }catch(e){
    console.warn("loadMyBrands:", e.message);
    MY_BRANDS = [];
  }
  renderBrandUI();
}

function renderBrandUI(){
  const hasBrands = MY_BRANDS.length > 0;

  // Вкладка «Виробник»
  const manuTabBtn = document.querySelector('.tab[data-tab="manufacturer"]');
  const manuPane = document.getElementById('manufacturer');
  if (manuTabBtn) manuTabBtn.style.display = hasBrands ? "" : "none";
  if (manuPane && !hasBrands && manuPane.classList.contains('active')) {
    document.querySelector('.tab[data-tab="user"]')?.click();
  }

  // Бейджі брендів поруч із email
  const chips = document.getElementById("myBrands");
  if (chips) {
    if (!hasBrands) {
      chips.innerHTML = "";
    } else {
      chips.innerHTML = MY_BRANDS.map(m =>
        `<span class="badge" title="${m.slug}">${m.name}${m.verified ? " ✅" : ""}</span>`
      ).join("");
    }
  }

  // Селект бренду в формі + автопідстановка якщо один
  const sel = document.getElementById("brand");
  const field = document.getElementById("brandField");
  const hint = document.getElementById("brandHint");

  if (sel) {
    if (!hasBrands) {
      sel.innerHTML = `<option value="">— у вас немає брендів —</option>`;
      if (field) field.style.display = '';
      if (hint) hint.style.display = 'none';
    } else if (MY_BRANDS.length === 1) {
      // один бренд → автопідстановка й ховаємо селект (залишаємо підпис)
      const b = MY_BRANDS[0];
      sel.innerHTML = `<option value="${b.slug}" selected>${b.name}${b.verified ? " ✅" : ""}</option>`;
      sel.value = b.slug;
      if (field) field.style.display = 'none';
      if (hint) hint.style.display = '';
    } else {
      // кілька брендів → показуємо селект
      sel.innerHTML = `<option value="">— оберіть бренд —</option>` +
        MY_BRANDS.map(b => `<option value="${b.slug}">${b.name}${b.verified ? " ✅" : ""}</option>`).join("");
      if (field) field.style.display = '';
      if (hint) hint.style.display = 'none';
    }
  }
}

// ---------- Create Product(s) ----------
const createForm = $('#createForm');
const createdBlock = $('#createdBlock');
let lastCreatedUrl = '';

createForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!authUser()){ alert('Увійдіть, будь ласка.'); return; }

  const fd = new FormData(createForm);
  const name = String(fd.get('name') || '').trim();
  let brand = String(fd.get('brand') || '').trim();
  const manufacturedAt = String(fd.get('manufacturedAt') || '').trim(); // опційно
  const image = String(fd.get('image') || '').trim();                   // опційно
  const editionCount = Number(fd.get('editionCount') || 1);

  if (!name){ alert('Введіть назву'); return; }
  if (!brand && MY_BRANDS.length === 1) brand = MY_BRANDS[0].slug; // автопідстановка
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

    // Підтримка партії та одиничного
    const list = Array.isArray(j?.created) ? j.created : [j];

    if (createdBlock) createdBlock.classList.remove('hidden');

    const first = list[0];
    const baseUrl = first.publicUrl || `${API}/details.html?id=${first.id}`;
    const url = addQuery(baseUrl, { s: first.serialHash });
    lastCreatedUrl = url;

    $('#createdId')?.textContent = list.length === 1 ? String(first.id) : `${list.length} шт. (партія)`;
    $('#createdState')?.textContent = first.state || '';
    $('#createdUrl')?.textContent = url;

    const qr = getPublicQR();
    if (qr) { qr.clear(); qr.makeCode(url); }

    await loadProducts();
    renderMyOwnedFromCache();
    createForm.reset();

  } catch (err) {
    alert(err.message || 'Помилка створення');
  }
});

// QR save
$('#downloadQR')?.addEventListener('click', () => {
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

// Copy URL
$('#copyUrl')?.addEventListener('click', async () => {
  if (!lastCreatedUrl) return;
  try {
    await navigator.clipboard.writeText(lastCreatedUrl);
    alert('Посилання скопійовано');
  } catch {
    alert('Не вдалося скопіювати');
  }
});

// ---------- Tables ----------
const tbody = $('#productsBody'); // виробник (показуємо свої + НЕ показуємо продані)
const myBody = $('#myBody');      // користувач (мої як owner)

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
    _lastProducts = Array.isArray(list) ? list.slice() : [];

    // 🔎 Фільтр для «Виробник»: показуємо лише
    // - продукти, де owner == я (незалежно від стану)
    // - АБО де seller == я І state == 'created' (тобто ще не продані)
    const me = authUser();
    const display = _lastProducts.filter(p => {
      const owner = (p.owner || '').toLowerCase() === me;
      const unsoldAsSeller = (p.seller || '').toLowerCase() === me && String(p.state).toLowerCase() === 'created';
      return owner || unsoldAsSeller;
    });

    if (!display.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Нічого не знайдено</td></tr>`;
    } else {
      tbody.innerHTML = '';
      display.forEach((p) => {
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
    }

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

// якщо вже авторизований
if (window.Auth && window.Auth.user) {
  loadMyBrands().then(() => {
    loadProducts();
    renderMyOwnedFromCache();
  });
}

// ручний перехід до деталей
$('#openDetails')?.addEventListener('click', () => {
  const id = ($('#manualId')?.value || '').trim();
  if (!id) return;
  location.href = `details.html?id=${encodeURIComponent(id)}`;
});

// оновлювати таблицю коли повернувся у вкладку
window.addEventListener('focus', () => {
  if (authUser()) loadProducts();
});

// Кошик бейдж
(function () {
  if (!window.MCart || !document.getElementById('cartCount')) return;
  window.MCart.updateBadge();
})();
