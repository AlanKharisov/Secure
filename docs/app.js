// docs/app.js

const API = window.location.origin;

// Таби
document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
        document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// helpers
const $  = (s)=>document.querySelector(s);
function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    const append = (child) => {
        if (child == null || child === false) return;
        if (Array.isArray(child)) { child.forEach(append); return; }
        if (typeof child === 'string') { e.appendChild(document.createTextNode(child)); return; }
        e.appendChild(child);
    };
    append(children);
    return e;
}
function addQuery(url, params){
    const u = new URL(url, window.location.origin);
    Object.entries(params || {}).forEach(([k,v])=>{
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    return u.toString();
}

// Автосерійник
const nameInput   = $('#name');
const serialInput = $('#serial');

function slugify(s){
    return (s||'').toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toUpperCase();
}
function shortId(){ return (Date.now() + Math.floor(Math.random()*9999)).toString(36).toUpperCase().slice(-6); }
function genSerialFromName(name){
    const y = new Date().getFullYear();
    const base = slugify(name) || 'ITEM';
    return `${base}-${y}-${shortId()}`;
}
if (nameInput && serialInput) {
    nameInput.addEventListener('input', ()=>{ serialInput.value = genSerialFromName(nameInput.value); });
}

// Ледача ініт QR
let publicQR = null;
function getPublicQR() {
    const node = document.getElementById('publicQR');
    if (!node) return null;
    if (!publicQR) publicQR = new QRCode(node, { text:'', width:180, height:180 });
    return publicQR;
}

// Створення продукту
const createForm   = $('#createForm');
const createdBlock = $('#createdBlock');

createForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(createForm).entries());
    try{
        const res = await fetch(`${API}/api/manufacturer/products`,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(data)
        });
        const p = await res.json();
        if(!res.ok) throw new Error(p.error || 'Create failed');

        const baseUrl = p.publicUrl || `${API}/details.html?id=${p.id}`;
        const url = addQuery(baseUrl, { s: p.serialHash });

        createdBlock?.classList.remove('hidden');
        $('#createdId').textContent    = p.id;
        $('#createdState').textContent = p.state;
        $('#createdUrl').textContent   = url;

        const qr = getPublicQR();
        if (qr) { qr.clear(); qr.makeCode(url); }

        await loadProducts();
        createForm.reset();
        if (serialInput) serialInput.value = '';
    }catch(err){
        alert(err.message);
    }
});

// Таблиця продуктів
const tbody = $('#productsBody');

async function loadProducts(){
    try{
        const res = await fetch(`${API}/api/products`);
        const list = await res.json();
        if (!tbody) return;

        tbody.innerHTML = '';
        if(!Array.isArray(list) || !list.length){
            tbody.innerHTML = `<tr><td colspan="5" class="muted">Ще немає продуктів</td></tr>`;
            return;
        }
        list.forEach(p=>{
            const detailsUrl = addQuery(`details.html?id=${p.id}`, { s: p.serialHash });
            const tr = el('tr',{},[
                el('td',{},String(p.id)),
                el('td',{},p.meta?.name || ''),
                el('td',{},p.meta?.serial || ''),
                el('td',{},el('span',{class:'badge'},p.state)),
                el('td',{},[
                    (()=> {
                        const view = el('a',{href:detailsUrl, target:'_blank', rel:'noopener'},'Деталі');
                        const actions = [view];
                        if(p.state!=='purchased' && p.state!=='claimed'){
                            const btn = el('button',{class:'btn', style:'margin-left:8px'},'Позначити купленим');
                            btn.addEventListener('click', ()=> markPurchased(p.id));
                            actions.push(btn);
                        }
                        return actions;
                    })()
                ])
            ]);
            tbody.appendChild(tr);
        });
    }catch(e){
        console.error('loadProducts error:', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Помилка завантаження</td></tr>`;
    }
}

async function markPurchased(id){
    try{
        const r = await fetch(`${API}/api/products/${id}/purchase`, {method:'POST'});
        const j = await r.json();
        if(!r.ok) throw new Error(j.error||'Failed');
        await loadProducts();
    }catch(e){ alert(e.message) }
}

loadProducts();

// Тестове відкриття details
$('#openDetails')?.addEventListener('click', ()=>{
    const id = ($('#manualId')?.value||'').trim();
    if(!id) return;
    location.href = `details.html?id=${encodeURIComponent(id)}`;
});