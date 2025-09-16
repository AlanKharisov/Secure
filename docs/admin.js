import { api, qs } from "./app.js";
import { Auth } from "./firebase.js";

const meInfo = qs("#meInfo");
const grantForm = qs("#grantAdminForm");
const grantOut = qs("#grantOut");
const brandForm = qs("#createBrandForUserForm");
const brandOut = qs("#brandCreateOut");
const verifyForm = qs("#verifyBrandForm");
const verifyOut = qs("#verifyOut");

Auth.onChange(async (u)=>{
    qs("#logoutBtn")?.classList.toggle("hidden", !u);
    if (!u) {
        meInfo.textContent = "Увійдіть як адмін.";
        return;
    }
    try {
        const me = await api("/api/me");
        if (!me.isAdmin) {
            meInfo.textContent = "Доступ заборонено (не адмін).";
            return;
        }
        meInfo.innerHTML = `<b>${me.email}</b> — Admin`;
    } catch(e){
        meInfo.textContent = e.message;
    }
});

qs("#logoutBtn")?.addEventListener("click", ()=>Auth.signOut());

grantForm?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const fd = new FormData(grantForm);
    const email = (fd.get("email")||"").toString().trim().toLowerCase();
    grantOut.textContent = "Надання прав…";
    try{
        await api("/api/admins/grant", { method:"POST", body:{ email } });
        grantOut.textContent = "Готово.";
        grantForm.reset();
    }catch(e){ grantOut.textContent = e.message; }
});

brandForm?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const fd = new FormData(brandForm);
    const name = (fd.get("name")||"").toString().trim();
    const email = (fd.get("email")||"").toString().trim().toLowerCase();
    brandOut.textContent = "Створення…";
    try{
        const res = await api("/api/admins/create-manufacturer", { method:"POST", body:{ name, email }});
        brandOut.textContent = `Створено: ${res.name} (${res.slug}) → ${res.owner}`;
        brandForm.reset();
    }catch(e){ brandOut.textContent = e.message; }
});

verifyForm?.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const fd = new FormData(verifyForm);
    const slug = (fd.get("slug")||"").toString().trim().toUpperCase().replace(/\s+/g,"-");
    verifyOut.textContent = "Верифікація…";
    try{
        const res = await api(`/api/manufacturers/${encodeURIComponent(slug)}/verify`, { method:"POST" });
        verifyOut.textContent = `Верифіковано: ${res.slug}`;
        verifyForm.reset();
    }catch(e){ verifyOut.textContent = e.message; }
});