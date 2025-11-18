// details.js — сторінка перевірки одного продукту
import { api } from "./app.js";
import { Auth } from "./firebase.js";
// ESM-версія QRCode (уникаємо UMD-помилки з "default export"):
import QRCode from "https://esm.sh/qrcode@1.5.3";

const qs = (s, d=document)=>d.querySelector(s);
const params = new URLSearchParams(location.search);
const id = Number.parseInt(params.get("id") || "0", 10);

function setAuthButtons(user){
  const loginBtn  = qs("#loginBtn");
  const logoutBtn = qs("#logoutBtn");
  if (loginBtn)  loginBtn.style.display  = user ? "none" : "";
  if (logoutBtn) logoutBtn.style.display = user ? "" : "none";
}

async function renderQR(url){
  const c = qs("#qr");
  if (!c) return;
  // квадратний QR з невеликим відступом
  await QRCode.toCanvas(c, url, { margin: 1, scale: 4 });
}

function renderDetails(data){
  const box = qs("#details");
  if (!box) return;

  const img = data.metadata?.image
    ? `<img src="${data.metadata.image}" alt="" style="max-width:200px;border-radius:12px">`
    : "";

  const certs = (data.metadata?.certificates || [])
    .map(c => `<li>${c}</li>`).join("") || "—";

  box.innerHTML = `
    <div class="row">
      <div>${img}</div>
      <div>
        <h3>${data.metadata?.name || "ITEM"}</h3>
        <p><b>Token:</b> ${data.tokenId}</p>
        <p><b>Brand:</b> ${data.brandSlug || "—"}</p>
        <p><b>SKU:</b> ${data.sku || "—"}</p>
        <p><b>Edition:</b> ${data.editionNo || 1}/${data.editionTotal || 1}</p>
        <p><b>Manufactured:</b> ${data.metadata?.manufacturedAt || "—"}</p>
        ${data.metadata?.serial
          ? `<p><b>Serial:</b> ${data.metadata.serial}</p>`
          : `<p class="muted">Серійник приховано</p>`}
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
}

function renderActions(data){
  const act = qs("#actions");
  if (!act) return;

  if (data.canAcquire) {
    act.innerHTML = `<form id="buy"><button class="btn">Отримати у власність</button></form>`;
    const buy = qs("#buy");
    buy?.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const btn = buy.querySelector("button");
      btn?.setAttribute("disabled", "true");
      try{
        // api() сам підставить Bearer токен; X-User у проді не потрібен
        await api(`/api/products/${id}/purchase`, { method:"POST" });
        // після покупки бек поставить state=purchased і зміниться canAcquire
        await load(); // перерендеримось
      }catch(err){
        alert("Помилка: " + (err.message || err));
      }finally{
        btn?.removeAttribute("disabled");
      }
    });
  } else {
    act.innerHTML = `<span class="muted">Ви вже власник або неавторизовані</span>`;
  }
}

async function load(){
  const box = qs("#details");
  if (!id || !Number.isFinite(id)) {
    if (box) box.textContent = "Bad id";
    return;
  }
  try{
    const data = await api(`/api/verify/${id}`);
    renderDetails(data);
    renderActions(data);
    await renderQR(location.href);
  }catch(e){
    if (box) box.textContent = e.message || "Помилка завантаження";
  }
}

// auth lifecycle
(function initAuth(){
  // кнопки входу/виходу
  qs("#loginBtn")?.addEventListener("click", ()=> Auth.signIn());
  qs("#logoutBtn")?.addEventListener("click", ()=> Auth.signOut());
  // при зміні користувача оновлюємо кнопки та перезавантажуємо дані (щоб з'явився серійник/кнопка купівлі)
  Auth.onChange(async (user)=>{
    setAuthButtons(user);
    await load();
  });
})();

// стартове завантаження (на випадок, якщо вже авторизований)
load();
