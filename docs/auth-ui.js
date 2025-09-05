(function () {
    const $ = (s, sc=document) => sc.querySelector(s);

    const emailEl = $("#authEmail");
    const photoEl = $("#authPhoto");
    const login   = $("#loginBtn");
    const logout  = $("#logoutBtn");
    const panel   = $("#authPanel");
    const gLogin  = $("#gLogin");
    const emailIn = $("#email");
    const passIn  = $("#password");
    const emailSignIn = $("#emailSignIn");
    const emailSignUp = $("#emailSignUp");
    const errBox  = $("#authErr");
    const accountLink = $("#accountLink");
    const brandChips = $("#brandChips");

    const adminTab = $("#adminTab");
    const manufTab = $("#manufTab");
    const userTab  = $("#userTab");

    function showErr(msg){
        if (!errBox) return;
        errBox.style.display = "block";
        errBox.textContent = msg;
    }
    function clearErr(){
        if (!errBox) return;
        errBox.style.display = "none";
        errBox.textContent = "";
    }

    function compactEmail(email) {
        if (!email) return "";
        // "al...@gmail.com"
        const [name, domain] = email.split("@");
        if (!domain) return email;
        const short = name.length > 3 ? (name.slice(0,2) + "…") : name;
        return `${short}@${domain}`;
    }

    async function fetchJSON(url, opts = {}) {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) return null;
        return await res.json();
    }

    async function fetchMyBrands(email) {
        if (!email) return [];
        // Перший варіант: бек має ендпойнт списку брендів користувача
        try {
            const url = `${window.API_BASE}/api/manufacturers?owner=${encodeURIComponent(email)}`;
            const j = await fetchJSON(url, { headers: { "X-User": email } });
            if (Array.isArray(j)) return j;
        } catch {}
        // Fallback: якщо в клієнтській конфігурації прописано, що користувач — виробник
        if (window.CLIENT_MANUFACTURERS && window.CLIENT_MANUFACTURERS.has(email)) {
            // повернемо псевдо-бренд
            return [{ name: "Your Brand", slug: "YOUR-BRAND", verified: true }];
        }
        return [];
    }

    function renderBrandChips(list) {
        if (!brandChips) return;
        brandChips.innerHTML = "";
        if (!list || !list.length) {
            const span = document.createElement("span");
            span.className = "muted small";
            span.textContent = "— у вас немає брендів —";
            brandChips.appendChild(span);
            return;
        }
        list.forEach(b => {
            const chip = document.createElement("span");
            chip.className = "badge";
            chip.textContent = b.name + (b.verified ? " ✓" : "");
            brandChips.appendChild(chip);
        });
    }

    function setTabsVisibility({ isAdmin, isManufacturer }) {
        if (adminTab) adminTab.style.display = isAdmin ? "" : "none";
        if (manufTab) manufTab.style.display = isManufacturer ? "" : "none";
        // Якщо активної вкладки нема (випадок першого входу) — активуємо Користувача
        const anyActive = document.querySelector(".tab.active");
        if (!anyActive) userTab?.classList.add("active");
    }

    async function onUserChange(u){
        clearErr();
        if (u) {
            // шапка
            if (emailEl) emailEl.textContent = compactEmail(u.email);
            if (photoEl) {
                if (u.photoURL) { photoEl.src = u.photoURL; photoEl.style.display = "inline-block"; }
                else photoEl.style.display = "none";
            }
            if (login)  login.style.display = "none";
            if (logout) logout.style.display = "inline-block";
            if (panel)  panel.classList.add("hidden");
            if (accountLink) accountLink.style.display = "inline-block";

            // Ролі
            const email = u.email || u.uid;
            let isAdmin = false;
            let brands = [];

            // Клієнтський fallback для адмінів
            if (window.CLIENT_ADMINS && window.CLIENT_ADMINS.has(email)) isAdmin = true;

            // Бренди користувача
            brands = await fetchMyBrands(email);
            const isManufacturer = Array.isArray(brands) && brands.length > 0;

            renderBrandChips(brands);
            setTabsVisibility({ isAdmin, isManufacturer });

            // кинути подію з профілем-ролями (щоб app.js міг взяти primaryBrand)
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
            setTabsVisibility({ isAdmin:false, isManufacturer:false });
            document.dispatchEvent(new CustomEvent("roles-ready", {
                detail: { email:"", isAdmin:false, isManufacturer:false, brands:[] }
            }));
        }
    }

    // Події
    document.addEventListener("auth-changed", (e) => onUserChange(e.detail));

    login?.addEventListener("click", () => {
        panel?.classList.toggle("hidden");
        clearErr();
    });
    logout?.addEventListener("click", () => window.Auth?.signOut().catch(e => showErr(e.message)));
    gLogin?.addEventListener("click", async () => {
        try { await window.Auth?.signInGoogle(); }
        catch(e){ showErr(e.message); }
    });
    emailSignIn?.addEventListener("click", async () => {
        try {
            clearErr();
            await window.Auth?.signInEmail((emailIn?.value||"").trim(), (passIn?.value||"").trim());
        } catch(e){ showErr(e.message); }
    });
    emailSignUp?.addEventListener("click", async () => {
        try {
            clearErr();
            await window.Auth?.signUpEmail((emailIn?.value||"").trim(), (passIn?.value||"").trim());
        } catch(e){ showErr(e.message); }
    });

    // Клік поза панеллю — закрити
    document.addEventListener("click", (ev) => {
        if (!panel || panel.classList.contains("hidden")) return;
        const inside = panel.contains(ev.target) || (login && login.contains(ev.target));
        if (!inside) panel.classList.add("hidden");
    });

    // Якщо вже авторизований до завантаження
    if (window.Auth && window.Auth.user) onUserChange(window.Auth.user);
})();
