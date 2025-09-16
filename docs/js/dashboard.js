document.getElementById('logout').addEventListener('click', (e)=>{ e.preventDefault(); logout(); });

async function loadMe(){
    const data = await api('/api/me');
    document.getElementById('me').textContent = JSON.stringify(data, null, 2);
}

async function loadProducts(){
    const list = await api('/api/products');
    const box = document.getElementById('products'); box.innerHTML = '';
    for(const p of list){
        const el = document.createElement('div'); el.className = 'card';
        el.innerHTML = `
      <img src="${p.image_url||''}" alt=""/>
      <div>
        <h3>${p.title}</h3>
        <p><b>Код:</b> ${p.code}</p>
        <p><b>Ціна:</b> ${(p.price_cents||0)/100} €</p>
        <button data-id="${p.id}" class="buy">Купити</button>
        <img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(location.origin+'/p/'+p.code)}"/>
      </div>`;
        box.appendChild(el);
    }
    for(const btn of document.querySelectorAll('.buy')){
        btn.addEventListener('click', async (e)=>{
            const id = Number(e.target.getAttribute('data-id'));
            const price = prompt('Вкажи ціну у цент/копійках', '1000'); if (!price) return;
            const res = await api('/api/purchase', { method:'POST', body: JSON.stringify({ productID:id, priceCents:Number(price) }) });
            alert('OK! Комісія 1% = '+res.fee_cents); loadWallet();
        });
    }
}

async function loadWallet(){
    const list = await api('/api/wallet');
    const box = document.getElementById('wallet'); box.innerHTML = '';
    for(const p of list){
        const el = document.createElement('div'); el.className = 'card';
        el.innerHTML = `<img src="${p.image_url||''}"><div><h3>${p.title}</h3><p>${p.code}</p></div>`;
        box.appendChild(el);
    }
}

const np = document.getElementById('new-product');
np.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = {
        title: document.getElementById('p-title').value.trim(),
        mfg_date: document.getElementById('p-mfg').value.trim(),
        image_url: document.getElementById('p-img').value.trim(),
        batch_qty: Number(document.getElementById('p-batch').value||0),
        code: document.getElementById('p-code').value.trim(),
        price_cents: Number(document.getElementById('p-price').value||0),
        brand_id: Number(document.getElementById('p-brand').value)
    };
    try{ await api('/api/products', { method:'POST', body: JSON.stringify(payload) }); loadProducts(); alert('Створено!') }catch(err){ alert(err.message) }
});

loadMe(); loadProducts(); loadWallet();
