// docs/js/api.js
(() => {
    const base = ""; // same-origin
    function getUser(){ return (localStorage.getItem("xUser")||"").trim(); }
    function setUser(email){ localStorage.setItem("xUser", (email||"").trim()); }

    function headers(json=true){
        const h = {};
        const u = getUser();
        if (u) h["X-User"] = u;
        if (json) h["Content-Type"] = "application/json";
        return h;
    }

    async function request(path, opts={}){
        const res = await fetch(base + path, opts);
        const text = await res.text().catch(()=> "");
        let data = null;
        try{ data = text ? JSON.parse(text) : null; }catch{ data = text; }
        return { ok: res.ok, status: res.status, data };
    }

    const API = {
        getUser, setUser,
        GET:  (p)    => request(p, { headers: headers(false) }),
        POST: (p,b)  => request(p, { method:"POST", headers: headers(true), body: JSON.stringify(b||{}) }),
        DEL:  (p)    => request(p, { method:"DELETE", headers: headers(false) })
    };

    // маленькі хелпери
    const $  = (sel, root=document) => root.querySelector(sel);
    const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
    const qs = new URLSearchParams(location.search);

    // Експортуємо у глобал
    window.API = API;
    window.$ = $;
    window.$$ = $$;
    window.qs = qs;
})();