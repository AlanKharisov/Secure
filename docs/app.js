// ===== CONFIG =====
const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || window.location.origin;

// ⚠️ Заполни своими e-mail виробників (Ниже в нижнем регистре!)
const MANUFACTURERS = new Set([
    "alankharisov1@gmail.com",
    "brand2@example.com",
    "brand3@example.com",
    "brand4@example.com",
    "brand5@example.com",
].map(s => s.toLowerCase()));

// ===== HELPERS =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const lower = (s)=>String(s||"").toLowerCase();

function authUser() {
    return (window.Auth && window.Auth.user)
        ? (window.Auth.user.email || window.Auth.user.uid || "")
        : "";
}
function authHeaders() {
    const u = authUser();
    return u ? { "X-User": u } : {};
}
function addQuery(url, params) {
    const u = new URL(url, window.location.origin);
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    return u.toString();
}
function esc(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (m) =>
        ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])
    );
}

let ROLE = { isMan: false, brandSlug: "" };

// Определяем, является ли пользователь виробником: в списке e-mail ИЛИ имеет вериф. бренд
async function computeRole() {
    const me = authUser();
    if (!me) { ROLE = { isMan: false, brandSlug: "" }; return ROLE; }

    let brandSlug = "";
    try {
        const r = await fetch(`${API}/api/manufacturers`, { headers: { ...authHeaders() } });
        if (r.ok) {
            const list = await r.json();
            if (Array.isArray(list)) {
                const mine = list.find(m => lower(m.owner||"") === lower(me) && m.verified);
                brandSlug = mine?.slug || "";
            }
        }
    } catch { /* ignore */ }

    ROLE = {
        isMan: MANUFACTURERS.has(lower(me)) || !!brandSlug,
        brandSlug,
    };
    return ROLE;
}

// ===== TABS =====
$$(".tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
        $$(".tab").forEach((b) => b.classList.remove("active"));
        $$(".tabpane").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const pane = document.getElementById(btn.dataset.tab);
        if (pane) pane.classList.add("active");

        const me = authUser();
        if (!me) return;

        if (btn.dataset.tab === "manPane") {
            await computeRole();
            if (!ROLE.isMan) {
                $("#manList").innerHTML = `<tr><td colspan="7" class="muted">Недостатньо прав (не виробник)</td></tr>`;
                return;
            }
            loadProductsForMan();
        } else if (btn.dataset.tab === "userPane") {
            loadProductsForUser();
        }
    });
});

// ===== QR MODAL =====
let qr, lastQRUrl = "";
const qrModal = $("#qrModal");
const qrNode = $("#qrNode");
$("#qrClose")?.addEventListener("click", () => (qrModal.style.display = "none"));
$("#qrDownload")?.addEventListener("click", () => {
    const node = qrNode.querySelector("canvas") || qrNode.querySelector("img");
    if (!node) return;
    const dataURL = node.tagName.toLowerCase() === "canvas" ? node.toDataURL("image/png") : (node.src || "");
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = "qr.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
});
$("#qrCopyUrl")?.addEventListener("click", async () => {
    if (!lastQRUrl) return;
    try { await navigator.clipboard.writeText(lastQRUrl); alert("Скопійовано"); }
    catch { alert("Не вдалося скопіювати"); }
});
function openQR(title, url) {
    $("#qrTitle").textContent = title;
    qrNode.innerHTML = "";
    if (!qr) qr = new QRCode(qrNode, { text: url, width: 220, height: 220 });
    else { qr.clear(); qr.makeCode(url); }
    lastQRUrl = url;
    qrModal.style.display = "flex";
}

// ===== COMMON ROW RENDER =====
function renderRowCommon(p) {
    const edition = `<span class="edition">${(p.editionNo || 1)}/${(p.editionTotal || 1)}</span>`;
    const brand = p.brand ? `${esc(p.brand)}${p.brandVerified ? ' <span class="check">✅</span>' : ''}` : '-';
    const actions = `
    <button class="btn" data-open="${p.id}">Деталі</button>
    <button class="btn ghost" data-qr="${p.id}">QR</button>
  `;
    return { edition, brand, actions };
}
function bindRowActions(tbody, list) {
    tbody.querySelectorAll("[data-open]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-open");
            window.open(addQuery(`details.html?id=${encodeURIComponent(id)}`, {}), "_blank", "noopener");
        });
    });
    tbody.querySelectorAll("[data-qr]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = Number(btn.getAttribute("data-qr"));
            const p = list.find((x) => Number(x.id) === id);
            if (!p) return;
            const url = p.publicUrl ? addQuery(p.publicUrl, { s: p.serialHash }) :
                addQuery(`${API}/details.html?id=${p.id}`, { s: p.serialHash });
            openQR(`Token #${p.id}`, url);
        });
    });
}

// ===== USER CREATE/LIST =====
const userCreateForm = $("#userCreateForm");
userCreateForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const me = authUser();
    if (!me) { alert("Увійдіть, будь ласка"); return; }

    const fd = new FormData(userCreateForm);
    const name = (fd.get("name") || "").toString().trim();
    const manufacturedAt = (fd.get("manufacturedAt") || "").toString().trim();
    const image = (fd.get("image") || "").toString().trim();

    if (!name) { alert("Вкажіть назву"); return; }
    if (!manufacturedAt) { alert("Вкажіть дату виготовлення"); return; }

    try {
        const res = await fetch(`${API}/api/user/products`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ name, manufacturedAt, image })
        });
        const p = await res.json();
        if (!res.ok) throw new Error(p.error || "Create failed");

        const detailsUrl = p.publicUrl || `${API}/details.html?id=${p.id}`;
        openQR(`Token #${p.id}`, addQuery(detailsUrl, { s: p.serialHash }));

        await loadProductsForUser();
        userCreateForm.reset();
    } catch (err) {
        alert(err.message);
    }
});

async function loadProductsForUser() {
    const body = $("#userList");
    const me = authUser();
    if (!me) { body.innerHTML = `<tr><td colspan="6" class="muted">Увійдіть</td></tr>`; return; }

    try {
        const res = await fetch(`${API}/api/products`, { headers: { ...authHeaders() } });
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error("Bad response");

        const mine = list.filter(p => lower(p.owner || "") === lower(me));

        if (!mine.length) {
            body.innerHTML = `<tr><td colspan="6" class="muted">Ще немає продуктів</td></tr>`;
            return;
        }

        body.innerHTML = "";
        mine.forEach(p => {
            const { edition, actions } = renderRowCommon(p);
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${p.id}</td>
        <td>${esc(p.meta?.name || "")}</td>
        <td class="mono">${esc(p.meta?.serial || "")}</td>
        <td>${edition}</td>
        <td><span class="badge">${esc(p.state)}</span></td>
        <td>${actions}</td>
      `;
            body.appendChild(tr);
        });
        bindRowActions(body, mine);
    } catch (e) {
        body.innerHTML = `<tr><td colspan="6" class="muted">Помилка завантаження</td></tr>`;
    }
}

// ===== MANUFACTURER CREATE/LIST =====
const manCreateForm = $("#manCreateForm");
manCreateForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const me = authUser();
    if (!me) { alert("Увійдіть, будь ласка"); return; }

    await computeRole();
    if (!ROLE.isMan) { alert("Недостатньо прав (не виробник)"); return; }

    const fd = new FormData(manCreateForm);
    const name = (fd.get("name") || "").toString().trim();
    const qty = Math.max(1, Math.min(100, Number(fd.get("qty") || "1")));
    const brand = (fd.get("brand") || "").toString().trim() || ROLE.brandSlug || "";
    const serial = (fd.get("serial") || "").toString().trim();
    const manufacturedAt = (fd.get("manufacturedAt") || "").toString().trim();
    const ipfsHash = (fd.get("ipfsHash") || "").toString().trim();
    const image = (fd.get("image") || "").toString().trim();

    if (!name) { alert("Вкажіть назву"); return; }

    try {
        const res = await fetch(`${API}/api/manufacturer/products`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ name, qty, brand, serial, manufacturedAt, ipfsHash, image })
        });
        const arr = await res.json();
        if (!res.ok) throw new Error(arr.error || "Create failed");
        if (!Array.isArray(arr)) throw new Error("Unexpected response");

        const first = arr[0];
        if (first) {
            const url = (first.publicUrl || `${API}/details.html?id=${first.id}`);
            openQR(`Token #${first.id}`, addQuery(url, { s: first.serialHash }));
        }

        await loadProductsForMan();
        manCreateForm.reset();
    } catch (err) {
        alert(err.message);
    }
});

async function loadProductsForMan() {
    const body = $("#manList");
    const me = authUser();
    if (!me) { body.innerHTML = `<tr><td colspan="7" class="muted">Увійдіть</td></tr>`; return; }

    await computeRole();
    if (!ROLE.isMan) { body.innerHTML = `<tr><td colspan="7" class="muted">Недостатньо прав (не виробник)</td></tr>`; return; }

    try {
        const res = await fetch(`${API}/api/products`, { headers: { ...authHeaders() } });
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error("Bad response");

        if (!list.length) {
            body.innerHTML = `<tr><td colspan="7" class="muted">Ще немає продуктів</td></tr>`;
            return;
        }

        body.innerHTML = "";
        list.forEach(p => {
            const { edition, brand, actions } = renderRowCommon(p);
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${p.id}</td>
        <td>${esc(p.meta?.name || "")}</td>
        <td class="mono">${esc(p.meta?.serial || "")}</td>
        <td>${edition}</td>
        <td>${brand}</td>
        <td><span class="badge">${esc(p.state)}</span></td>
        <td>${actions}</td>
      `;
            body.appendChild(tr);
        });
        bindRowActions(body, list);
    } catch (e) {
        body.innerHTML = `<tr><td colspan="7" class="muted">Помилка завантаження</td></tr>`;
    }
}

// ===== AUTH INTEGRATION =====
document.addEventListener("auth-changed", async () => {
    const me = authUser();
    const manTabBtn = $(`.tab[data-tab="manPane"]`);

    if (me) {
        await computeRole();
        if (manTabBtn) manTabBtn.disabled = !ROLE.isMan;
        loadProductsForUser();
        if (ROLE.isMan && $("#manPane").classList.contains("active")) loadProductsForMan();
    } else {
        if (manTabBtn) manTabBtn.disabled = true;
        $("#userList").innerHTML = `<tr><td colspan="6" class="muted">Увійдіть</td></tr>`;
        $("#manList").innerHTML  = `<tr><td colspan="7" class="muted">Увійдіть як виробник</td></tr>`;
    }
});

if (window.Auth && window.Auth.user) {
    document.dispatchEvent(new CustomEvent("auth-changed", { detail: window.Auth.user }));
}