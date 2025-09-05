(function () {
    const API = window.API_BASE || window.location.origin;
    const $ = (s, sc=document) => sc.querySelector(s);

    const KEY = "marki.cart.v1";

    function read(){
        try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
        catch { return []; }
    }
    function save(items){
        localStorage.setItem(KEY, JSON.stringify(items));
        updateBadge();
    }
    function count(){ return read().length; }
    function exists(id){ return read().some(x => Number(x.id) === Number(id)); }
    function add(item){
        const items = read();
        if (!items.some(x => Number(x.id) === Number(item.id))) {
            items.push(item);
            save(items);
        }
    }
    function remove(id){
        const items = read().filter(x => Number(x.id) !== Number(id));
        save(items);
    }
    function clear(){ save([]); }

    function updateBadge(){
        const el = document.getElementById("cartCount");
        if (el) el.textContent = String(count());
    }

    window.MCart = { read, save, add, remove, clear, count, exists, updateBadge };
    document.addEventListener("DOMContentLoaded", updateBadge);

    // ===== Page wiring (if exists) =====
    const body = $("#cartBody");
    const qty  = $("#cartQty");
    const btn  = $("#checkoutBtn");
    const msg  = $("#checkoutMsg");

    function render(){
        if (!body || !qty) return;
        const items = read();
        body.innerHTML = "";
        if(!items.length){
            body.innerHTML = `<tr><td colspan="5" class="muted">Кошик порожній</td></tr>`;
            qty.textContent = "0";
            if (btn) btn.disabled = true;
            return;
        }
        items.forEach(item=>{
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${item.image ? `<img class="thumb" src="${item.image}" alt="">` : ""}</td>
        <td><a href="${item.url || `details.html?id=${item.id}`}" target="_blank" rel="noopener">${item.name||"-"}</a></td>
        <td class="mono">${item.serial||"-"}</td>
        <td class="mono">${item.id}</td>
        <td><button class="btn" data-remove="${item.id}">Видалити</button></td>
      `;
            body.appendChild(tr);
        });
        body.querySelectorAll("[data-remove]").forEach(b=>{
            b.addEventListener("click", ()=>{
                remove(b.getAttribute("data-remove"));
                render();
            });
        });
        qty.textContent = String(items.length);

        // Увімкнути оформлення лише коли є користувач
        if (btn) btn.disabled = !(window.Auth && window.Auth.user);
    }

    async function checkout(){
        const items = read();
        const user  = window.Auth?.user;
        if(!user){ alert("Будь ласка, увійдіть у свій акаунт."); return; }
        if(!items.length) return;

        if (!btn || !msg) return;
        btn.disabled = true; msg.style.display = "block";
        msg.className = "result"; msg.textContent = "Проводимо покупку...";

        const ok = []; const fail = [];
        for (const it of items){
            try{
                const r = await fetch(`${API}/api/products/${it.id}/purchase`, {
                    method:"POST",
                    headers:{ "Content-Type":"application/json", "X-User": (user.email || user.uid) },
                    body: "{}"
                });
                const j = await r.json();
                if(!r.ok){ fail.push({it, err: j.error || "error"}); }
                else { ok.push(it); }
            }catch(e){ fail.push({it, err: e.message}); }
        }

        if (fail.length === 0){
            clear();
            render();
            msg.className = "result ok";
            msg.innerHTML = "Готово! Усі товари позначені як придбані.<br>" +
                "<b>Чек:</b><br>" + ok.map(o=>`#${o.id} — ${o.name} <span class="mono">(${o.serial})</span>`).join("<br>");
        } else {
            const left = read().filter(x => !ok.some(o=>o.id===x.id));
            save(left);
            render();
            msg.className = "result warn";
            msg.innerHTML = `Частково виконано. Успішно: ${ok.length}, з помилкою: ${fail.length}.<br>` +
                (ok.length ? "<b>Оформлено:</b><br>" + ok.slice(0,5).map(o=>`#${o.id} — ${o.name}`).join("<br>") + (ok.length>5?"<br>…":"") + "<br>" : "") +
                "<b>Проблемні:</b><br>" + fail.slice(0,5).map(f=>`#${f.it.id}: ${f.err}`).join("<br>") + (fail.length>5?"<br>…":"");
        }
        btn.disabled = false;
    }

    if (btn) btn.addEventListener("click", checkout);
    render();

    // Перемикати доступність при зміні auth
    document.addEventListener("auth-changed", ()=> render());
})();
