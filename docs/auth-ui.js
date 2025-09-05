(function(){
  const API = window.API_BASE || window.location.origin;
  const $ = (s, sc)=> (sc||document).querySelector(s);

  function authUser(){
    return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
  }
  function esc(s){ return (s==null?"":String(s)).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); }

  // ---------- simple fetch JSON helper ----------
  function fetchJSON(url, opts){
    return fetch(url, opts||{}).then(async res=>{
      const ct = (res.headers.get("content-type")||"").toLowerCase();
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      return { ok: res.ok, data: body };
    });
  }

  // ---------- brands by owner email ----------
  async function fetchMyBrands(email){
    if (!email) return [];
    try{
      const url = API + "/api/manufacturers?owner=" + encodeURIComponent(email);
      const r = await fetchJSON(url, { headers: { "X-User": email } });
      if (r.ok && Array.isArray(r.data)) return r.data;
    }catch(_){}
    // fallback
    if (window.EMAIL_BRANDS && window.EMAIL_BRANDS[email]) return window.EMAIL_BRANDS[email];
    if (window.CLIENT_MANUFACTURERS && window.CLIENT_MANUFACTURERS.has(email)) return [{ name:"Your Brand", slug:"YOUR-BRAND", verified:false }];
    return [];
  }

  function compactEmail(email) {
    if (!email) return "";
    const [name, domain] = email.split("@");
    if (!domain) return email;
    const short = name.length > 3 ? (name.slice(0,2) + "…") : name;
    return short + "@" + domain;
  }

  // ---------- render auth box ----------
  function setupAuthUI(scope=document){
    const emailEl = $("#authEmail", scope);
    const photoEl = $("#authPhoto", scope);
    const login   = $("#loginBtn", scope);
    const logout  = $("#logoutBtn", scope);
    const panel   = $("#authPanel", scope);
    const gLogin  = $("#gLogin", scope);
    const emailIn = $("#email", scope);
    const passIn  = $("#password", scope);
    const emailSignIn = $("#emailSignIn", scope);
    const emailSignUp = $("#emailSignUp", scope);
    const errBox  = $("#authErr", scope);
    const accountLink = $("#accountLink", scope);
    const brandChips = $("#brandChips", scope);

    const adminTab = $("#adminTab");
    const manufTab = $("#manufTab");
    const userTab  = $("#userTab");

    function showErr(msg){ if (errBox){ errBox.style.display='block'; errBox.textContent = msg; } }
    function clearErr(){ if (errBox){ errBox.style.display='none'; errBox.textContent = ""; } }

    function renderBrandChips(list){
      if (!brandChips) return;
      brandChips.innerHTML = "";
      if (!list || !list.length){
        const span = document.createElement("span");
        span.className = "muted small";
        span.textContent = "— у вас немає брендів —";
        brandChips.appendChild(span);
        return;
      }
      list.forEach(b=>{
        const chip = document.createElement("span");
        chip.className = "badge";
        chip.textContent = b.name + (b.verified ? " ✓" : "");
        brandChips.appendChild(chip);
      });
    }

    function setTabsVisibility(isAdmin, isManufacturer){
      if (adminTab) adminTab.style.display = isAdmin ? "" : "none";
      if (manufTab) manufTab.style.display = isManufacturer ? "" : "none";
      // завжди є вкладка користувача
      if (userTab && !document.querySelector(".tab.active")) userTab.classList.add("active");
    }

    async function onUserChange(u){
      clearErr();
      if (u){
        if (emailEl) emailEl.textContent = compactEmail(u.email);
        if (photoEl) {
          if (u.photoURL){ photoEl.src = u.photoURL; photoEl.style.display = "inline-block"; }
          else photoEl.style.display = "none";
        }
        if (login)  login.style.display = "none";
        if (logout) logout.style.display = "inline-block";
        if (panel)  panel.classList.add("hidden");
        if (accountLink) accountLink.style.display = "inline-block";

        const email = u.email || u.uid;
        const isAdmin = !!(window.CLIENT_ADMINS && window.CLIENT_ADMINS.has && window.CLIENT_ADMINS.has(email));
        const brands = await fetchMyBrands(email);
        const isManufacturer = isAdmin || (Array.isArray(brands) && brands.length>0);

        renderBrandChips(brands);
        setTabsVisibility(isAdmin, isManufacturer);

        document.dispatchEvent(new CustomEvent("roles-ready", {
          detail: { email, isAdmin, isManufacturer, brands }
        }));
      } else {
        if (emailEl) emailEl.textContent = "";
        if (photoEl) photoEl.style.display = "none";
        if (login)  login.style.display = "inline-block";
        if (logout) logout.style.display = "none";
        if (accountLink) accountLink.style.display = "none";
        renderBrandChips([]);
        setTabsVisibility(false, false);
        document.dispatchEvent(new CustomEvent("roles-ready", {
          detail: { email:"", isAdmin:false, isManufacturer:false, brands:[] }
        }));
      }
    }

    document.addEventListener("auth-changed", e => onUserChange(e.detail));

    if (login)  login.addEventListener("click", ()=>{ if(panel){ panel.classList.toggle("hidden"); clearErr(); }});
    if (logout) logout.addEventListener("click", ()=> window.Auth?.signOut().catch(e=>showErr(e.message)));
    if (gLogin) gLogin.addEventListener("click", ()=> window.Auth?.signInGoogle().catch(e=>showErr(e.message)));
    if (emailSignIn) emailSignIn.addEventListener("click", ()=>{
      clearErr();
      window.Auth?.signInEmail((emailIn?.value||"").trim(), (passIn?.value||"").trim()).catch(e=>showErr(e.message));
    });
    if (emailSignUp) emailSignUp.addEventListener("click", ()=>{
      clearErr();
      window.Auth?.signUpEmail((emailIn?.value||"").trim(), (passIn?.value||"").trim()).catch(e=>showErr(e.message));
    });

    document.addEventListener("click", (ev)=>{
      if (!panel || panel.classList.contains("hidden")) return;
      const inside = panel.contains(ev.target) || (login && login.contains(ev.target));
      if (!inside) panel.classList.add("hidden");
    });

    // якщо вже авторизований до завантаження
    if (window.Auth && window.Auth.user) onUserChange(window.Auth.user);
  }

  document.addEventListener("DOMContentLoaded", ()=> setupAuthUI(document));
})();
