const API = window.API_BASE || window.location.origin;
const $ = (s, sc=document) => sc.querySelector(s);
function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function authUser() { return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
function authHeaders() { const u = authUser(); return u ? { "X-User": u } : {}; }

const qs = new URLSearchParams(location.search);
const id  = qs.get("id");

async function load() {
    const box = $("#content");
    if (!id) { box.innerHTML = '<div class="result bad">Немає id</div>'; return; }

    try {
        const r = await fetch(`${API}/api/verify/${encodeURIComponent(id)}`, { headers: { ...authHeaders() } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Not found");

        const imgHTML = (j.metadata.image || "").trim()
            ? `<img class="prodimg" src="${esc(j.metadata.image)}" alt="Фото">`
            : `<div class="muted">Немає зображення</div>`;

        const isFull = j.scope === "full";
        const serial = isFull ? esc(j.metadata.serial) : "приховано";
        const ipfs   = isFull ? esc(j.ipfsHash || "-") : "приховано";
        const serialHash = isFull ? esc(j.serialHash || "-") : "приховано";

        const buyBtn = (!isFull && j.state === "created")
            ? `<div style="margin-top:12px"><button id="buyBtn" class="btn primary">Купити (отримати у власність)</button></div>`
            : ``;

        const certs = (j.metadata.certificates || []);
        const certsHTML = certs.length
            ? certs.map(c => `<span class="badge">${esc(c)}</span>`).join(" ")
            : '<span class="muted">немає</span>';

        box.innerHTML = `
      <div class="hero">
        <div class="imgwrap">${imgHTML}</div>
        <div class="info">
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between">
            <h2 style="margin:0">${esc(j.metadata.name)}</h2>
            <span class="badge">${esc(j.state)}</span>
          </div>

          <div class="mono" style="margin-top:6px">TokenId: ${esc(String(j.tokenId))}</div>
          <div class="mono">Serial: ${serial}</div>
          <div class="mono">SerialHash: ${serialHash}</div>
          <div class="mono">IPFS: ${ipfs}</div>
          <div>Вироблено: ${esc(j.metadata.manufacturedAt || "-")}</div>
          <div style="margin-top:10px">Сертифікати: ${certsHTML}</div>
          ${buyBtn}
        </div>
      </div>`;

        const btn = document.getElementById("buyBtn");
        if (btn) {
            btn.addEventListener("click", async () => {
                const u = window.Auth?.user;
                if (!u) { alert("Увійдіть, будь ласка."); return; }
                btn.disabled = true;
                try {
                    const resp = await fetch(`${API}/api/products/${encodeURIComponent(j.tokenId)}/purchase`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...authHeaders() },
                        body: "{}"
                    });
                    const ok = await resp.json();
                    if (!resp.ok) throw new Error(ok.error || "error");
                    alert("Готово! Ви стали власником. Перезавантажую сторінку…");
                    location.reload();
                } catch (e) {
                    alert(e.message);
                } finally {
                    btn.disabled = false;
                }
            });
        }
    } catch (e) {
        $("#content").innerHTML = `<div class="result bad">Помилка: ${esc(e.message)}</div>`;
    }
}

document.addEventListener("auth-changed", load);
load();
