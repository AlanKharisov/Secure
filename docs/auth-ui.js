// docs/auth-ui.js
// UI авторизации: сокращённый email, фото, панель входа, бейдж бренда (пер-почтовый кэш)
(function(){
    "use strict";
    const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || window.location.origin;
    const BRAND_CACHE_PREFIX = "marki.brandSlug:";

    function $(s, scope){ return (scope||document).querySelector(s); }
    const lower = (s)=>String(s||"").toLowerCase();

    function shortEmail(email){
        if (!email) return "";
        const [u="", d=""] = String(email).split("@");
        const us = u.length <= 3 ? u : (u.slice(0,3) + "…");
        if (!d) return us;
        const dp = d.split(".");
        const first = dp[0] || "";
        const last  = dp[dp.length-1] || "";
        const ds = (first ? first[0] + "…" : "") + (last && dp.length>1 ? last : "");
        return us + "@" + ds;
    }

    function getCachedBrand(email){ return localStorage.getItem(BRAND_CACHE_PREFIX + lower(email)) || ""; }
    function setCachedBrand(email, slug){ if (email) localStorage.setItem(BRAND_CACHE_PREFIX + lower(email), slug||""); }
    function clearCachedBrand(email){ if (email) localStorage.removeItem(BRAND_CACHE_PREFIX + lower(email)); }

    async function fetchMyVerifiedBrand(user){
        if (!user) return "";
        try{
            const r = await fetch(`${API}/api/manufacturers`, { headers: { "X-User": user } });
            if (r.ok) {
                const list = await r.json();
                if (Array.isArray(list)) {
                    const me = lower(user);
                    const mine = list.find(m => lower(m.owner||"") === me && m.verified);
                    if (mine && mine.slug) {
                        setCachedBrand(user, mine.slug);
                        return mine.slug;
                    }
                }
            }
        }catch{}
        return getCachedBrand(user);
    }

    function setupAuthUI(scope){
        scope = scope || document;

        const emailEl = $('#authEmail', scope) || $('#pEmail', scope);
        const photoEl = $('#authPhoto', scope) || $('#pPhoto', scope);
        const login   = $('#loginBtn',  scope);
        const logout  = $('#logoutBtn', scope);
        const panel   = $('#authPanel', scope);
        const gLogin  = $('#gLogin',    scope);
        const emailIn = $('#email',     scope);
        const passIn  = $('#password',  scope);
        const emailSignIn = $('#emailSignIn', scope);
        const emailSignUp = $('#emailSignUp', scope);
        const errBox  = $('#authErr', scope);
        const accountLink = $('#accountLink', scope);
        const roleBadges  = $('#roleBadges', scope);

        function showErr(msg){ if (errBox){ errBox.style.display = "block"; errBox.textContent = msg; } }
        function clearErr(){ if (errBox){ errBox.style.display = "none"; errBox.textContent = ""; } }

        function setUser(u){
            clearErr();
            const full   = u ? (u.email || u.displayName || u.uid || "") : "";
            const masked = shortEmail(u && (u.email || u.uid));

            if (u){
                if (emailEl){ emailEl.textContent = masked; emailEl.title = full; }
                if (photoEl){
                    if (u.photoURL){ photoEl.src = u.photoURL; photoEl.style.display="inline-block"; }
                    else photoEl.style.display="none";
                }
                if (login)  login.style.display  = "none";
                if (logout) logout.style.display = "inline-block";
                if (panel)  panel.classList.add("hidden");
                if (accountLink) accountLink.style.display = "inline-block";

                (async ()=>{
                    const me  = u.email || u.uid || "";
                    const slug = await fetchMyVerifiedBrand(me);
                    if (roleBadges) roleBadges.innerHTML = slug ? `<span class="badge">Бренд: ${slug} ✅</span>` : "";
                    const brandInput = document.querySelector('#manCreateForm [name="brand"]');
                    if (brandInput && slug && !brandInput.value.trim()) brandInput.value = slug;
                    document.dispatchEvent(new CustomEvent("brand-ready", { detail: { slug } }));
                })();

            } else {
                if (emailEl){ emailEl.textContent = ""; emailEl.removeAttribute("title"); }
                if (photoEl) photoEl.style.display = "none";
                if (login)  login.style.display  = "inline-block";
                if (logout) logout.style.display = "none";
                if (accountLink) accountLink.style.display = "none";
                if (roleBadges) roleBadges.innerHTML = "";
            }
        }

        document.addEventListener("auth-changed", e => setUser(e.detail));
        if (window.Auth) setUser(window.Auth.user);

        login?.addEventListener("click", ()=>{
            if (panel) { panel.classList.toggle("hidden"); clearErr(); }
        });
        logout?.addEventListener("click", async ()=>{
            const me = (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : "";
            if (me) clearCachedBrand(me);
            try { await window.Auth?.signOut(); } catch(e){ showErr(e?.message || String(e)); }
        });

        gLogin?.addEventListener("click", async ()=>{ try { await window.Auth?.signInGoogle(); } catch(e){ showErr(e?.message || String(e)); } });
        emailSignIn?.addEventListener("click", async ()=>{
            try{ clearErr(); await window.Auth?.signInEmail((emailIn?.value||"").trim(), (passIn?.value||"").trim()); }
            catch(e){ showErr(e?.message || String(e)); }
        });
        emailSignUp?.addEventListener("click", async ()=>{
            try{ clearErr(); await window.Auth?.signUpEmail((emailIn?.value||"").trim(), (passIn?.value||"").trim()); }
            catch(e){ showErr(e?.message || String(e)); }
        });

        document.addEventListener("click", (ev)=>{
            if (!panel || panel.classList.contains("hidden")) return;
            const inside = panel.contains(ev.target) || (login && login.contains(ev.target));
            if (!inside) panel.classList.add("hidden");
        });
    }

    document.addEventListener("DOMContentLoaded", ()=> setupAuthUI(document));
})();