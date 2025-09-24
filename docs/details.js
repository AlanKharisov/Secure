import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js";

const el = (s, d=document)=>d.querySelector(s);
const params = new URLSearchParams(location.search);
const id = parseInt(params.get("id")||"0",10);

async function load(){
  const box = el("#details");
  const act = el("#actions");
  if(!id){ box.textContent = "Bad id"; return; }
  try{
    const res = await fetch(`/api/verify/${id}`);
    if(!res.ok) throw new Error((await res.json()).error||res.statusText);
    const data = await res.json();

    const img = data.metadata?.image ? `<img src="${data.metadata.image}" alt="" style="max-width:200px;border-radius:12px">`:"";
    const certs = (data.metadata?.certificates||[]).map(c=>`<li>${c}</li>`).join("") || "—";

    box.innerHTML = `
      <div class="row">
        <div>${img}</div>
        <div>
          <h3>${data.metadata?.name||"ITEM"}</h3>
          <p><b>Token:</b> ${data.tokenId}</p>
          <p><b>Brand:</b> ${data.brandSlug||"—"}</p>
          <p><b>SKU:</b> ${data.sku||"—"}</p>
          <p><b>Edition:</b> ${data.editionNo||1}/${data.editionTotal||1}</p>
          <p><b>Manufactured:</b> ${data.metadata?.manufacturedAt||"—"}</p>
          ${data.metadata?.serial ? `<p><b>Serial:</b> ${data.metadata.serial}</p>` : `<p class="muted">Серійник приховано</p>`}
          <p><b>State:</b> <span class="tag">${data.state}</span></p>
          <p><b>Certificates:</b></p>
          <ul>${certs}</ul>
        </div>
      </div>
      <div class="mt">
        <canvas id="qr"></canvas>
        <div class="muted">Скануй, щоб відкрити цю сторінку</div>
      </div>
    `;

    // QR з поточного URL (деталі)
    const c = el("#qr");
    await QRCode.toCanvas(c, location.href, { margin:1, scale:4 });

    act.innerHTML = data.canAcquire
      ? `<form id="buy"><button class="btn">Отримати у власність</button></form>`
      : `<span class="muted">Ви вже власник або неавторизовані</span>`;

    const buy = el("#buy");
    if (buy) buy.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const res = await fetch(`/api/products/${id}/purchase`, { method:"POST", headers:{ "X-User": "" }});
      if(!res.ok){ alert("Помилка: " + (await res.text())); return; }
      location.reload();
    });
  }catch(e){
    box.textContent = e.message || "Помилка завантаження";
  }
}
load();
