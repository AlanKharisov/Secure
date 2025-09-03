const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || window.location.origin;
const $ = (s)=>document.querySelector(s);

function authUser() {
    return (window.Auth && window.Auth.user)
        ? (window.Auth.user.email || window.Auth.user.uid || "")
        : "";
}
function authHeaders() {
    const u = authUser();
    return u ? { "X-User": u } : {};
}
function esc(s){
    return (s ?? "").toString().replace(/[&<>"']/g, (m) =>
        ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])
    );
}

(async function load(){
    const qs = new URLSearchParams(location.search);
    const id  = qs.get("id");

    const box = $("#content");
    if (!id){ box.innerHTML = '<div class="result bad">Немає id</div>'; return; }

    try{
        const r = await fetch(`${API}/api/verify/${encodeURIComponent(id)}`, { headers:{...authHeaders()} });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Not found");

        const img = (j.metadata.image||"").trim()
            ? `<img class="thumb" src="${esc(j.metadata.image)}" alt="" style="width:100%;max-height:300px;object-fit:cover;border-radius:10px">`
            : `<div class="muted">Немає зображення</div>`;

        const isFull = j.scope === "full";
        const serial = isFull ? esc(j.metadata.serial) : "приховано";
        const ipfs   = isFull ? esc(j.ipfsHash || "-")   : "приховано";
        const serialHash = isFull ? esc(j.serialHash||"-") : "приховано";

        const addBtn = `<button id="addToCart" class="btn primary">Додати в кошик</button>`;
        const buyNow = `<button id="buyNow" class="btn">Купити зараз</button>`;

        box.innerHTML = `
      <div class="card">
        <div style="display:flex;flex-wrap:wrap;gap:16px">
          <div style="flex:0 0 320px;background:#0c1330;border-radius:14px;border:1px solid var(--border);padding:12px">${img}</div>
          <div style="flex:1;border:1px solid var(--border);border-radius:14px;padding:14px;background:linear-gradient(180deg, rgba(19,26,52,.75), rgba(12,17,39,.75))">
            <div style="display:flex;gap:10px;align-items:center;justify-content:space-between">
              <h2 style="margin:0">${esc(j.metadata.name)}</h2>
              <span class="badge">${esc(j.state)}</span>
            </div>
            <div class="mono" style="margin-top:6px">TokenId: ${esc(String(j.tokenId))}</div>
            <div class="mono">Serial: ${serial}</div>
            <div class="mono">SerialHash: ${serialHash}</div>
            <div class="mono">IPFS: ${ipfs}</div>
            <div>Вироблено: ${esc(j.metadata.manufacturedAt||"-")}</div>
            <div style="margin-top:10px">Сертифікати: ${(j.metadata.certificates||[]).map(c=>`<span class="badge">${esc(c)}</span>`).join(" ") || '<span class="muted">немає</span>'}</div>
            <div class="row" style="margin-top:12px;gap:8px">
              ${addBtn}
              ${buyNow}
            </div>
          </div>
        </div>
      </div>`;

        // Add to cart
        $("#addToCart")?.addEventListener("click", ()=>{
            const item = {
                id: j.tokenId,
                name: j.metadata.name || "",
                serial: j.metadata.serial || "",
                image: j.metadata.image || "",
                url: j.publicUrl || `details.html?id=${j.tokenId}`,
            };
            window.MCart?.add(item);
            alert("Додано в кошик");
        });

        // Buy now (опционально)
        $("#buyNow")?.addEventListener("click", async ()=>{
            const me = authUser();
            if (!me){ alert("Увійдіть, будь ласка."); return; }
            if (!confirm("Позначити товар як придбаний для вас зараз?")) return;

            try{
                const resp = await fetch(`${API}/api/products/${encodeURIComponent(j.tokenId)}/purchase`, {
                    method:"POST",
                    headers:{ "Content-Type":"application/json", ...authHeaders() },
                    body: "{}"
                });
                const ok = await resp.json();
                if (!resp.ok) throw new Error(ok.error || "error");
                alert("Готово! Ви стали власником.");
                location.reload();
            }catch(e){
                alert(e.message);
            }
        });

    }catch(e){
        box.innerHTML = `<div class="result bad">Помилка: ${esc(e.message)}</div>`;
    }
})();
