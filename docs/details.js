import { api, qs, h, qrImg } from "./app.js";
import { Auth } from "./firebase.js";

const params = new URLSearchParams(location.search);
const id = Number(params.get("id")||"0");
const details = qs("#details");
const actions = qs("#actions");

Auth.onChange(async (u)=>{
    qs("#loginBtn")?.classList.toggle("hidden", !!u);
    qs("#logoutBtn")?.classList.toggle("hidden", !u);
    await load();
});

async function load(){
    if (!id) { details.textContent = "Bad id"; return; }
    details.textContent = "Завантаження…";
    actions.innerHTML = "";
    try{
        const data = await api(`/api/verify/${id}`);
        const url = data.publicUrl || `${location.origin}/details.html?id=${id}`;
        const meta = data.metadata || {};

        const box = h("div", { class:"grid" },
            h("div", { class:"row" },
                h("div", { class:"qr" }, qrImg(url, 160)),
                h("div", {},
                    h("div", {}, h("b", {}, meta.name || "Без назви")),
                    h("div", {}, `ID: ${data.tokenId}`),
                    h("div", {}, `Стан: ${data.state}`),
                    h("div", {}, `Видимість: ${data.scope}`),
                    h("div", {}, h("a", { href:url, target:"_blank" }, "Публічне посилання"))
                )
            )
        );
        details.replaceChildren(box);

        if (data.canAcquire) {
            const btn = h("button", { class:"primary", id:"buyBtn" }, "Забрати собі");
            btn.addEventListener("click", async ()=>{
                btn.disabled = true; btn.textContent = "Забираю…";
                try{
                    await api(`/api/products/${id}/purchase`, { method:"POST" });
                    btn.textContent = "Готово!";
                    setTimeout(()=>location.reload(), 800);
                }catch(e){
                    btn.disabled = false; btn.textContent = "Забрати собі";
                    alert(e.message);
                }
            });
            actions.appendChild(btn);
        }
    }catch(e){
        details.textContent = e.message;
    }
}

qs("#logoutBtn")?.addEventListener("click", ()=>Auth.signOut());