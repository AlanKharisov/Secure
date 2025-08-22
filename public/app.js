// БАЗА API: той самий домен, з якого відкрито сторінку
const API = window.location.origin;

document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// helpers
function $(sel){ return document.querySelector(sel) }
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
function showResult(kind, html){
  const box = $('#resultBox');
  box.className = `result ${kind==='ok'?'ok':kind==='warn'?'warn':'bad'}`;
  box.innerHTML = html;
}

// Manufacturer: create
const createForm = $('#createForm');
const createdBlock = $('#createdBlock');
const labelQR  = new QRCode(document.getElementById('labelQR'),  {text:'', width:180, height:180});
const publicQR = new QRCode(document.getElementById('publicQR'), {text:'', width:180, height:180});

createForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const data = Object.fromEntries(new FormData(createForm).entries());
  try{
    const res = await fetch(`${API}/api/manufacturer/products`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    const p = await res.json();
    if(!res.ok) throw new Error(p.error || 'Create failed');

    createdBlock.classList.remove('hidden');
    $('#createdId').textContent = p.id;
    $('#createdState').textContent = p.state;
    $('#createdIpfs').textContent = p.ipfsHash;

    // JSON QR (службовий)
    labelQR.clear();
    labelQR.makeCode(JSON.stringify(p.qrPayload));

    // Public URL QR (для смартфона)
    const url = p.publicUrl || `${API}/details.html?id=${p.id}`;
    $('#createdUrl').textContent = url;
    publicQR.clear();
    publicQR.makeCode(url);

    await loadProducts();
    createForm.reset();
  }catch(err){
    alert(err.message);
  }
});

// Products table & actions
const tbody = $('#productsBody');
const productSelect = $('#productSelect');
const issueBtn = $('#issueBtn');

async function loadProducts(){
  const res = await fetch(`${API}/api/products`);
  const list = await res.json();

  tbody.innerHTML = '';
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Ще немає продуктів</td></tr>`;
  } else {
    list.forEach(p=>{
      const tr = el('tr',{},[
        el('td',{},p.id.toString()),
        el('td',{},p.meta.name),
        el('td',{},p.meta.serial),
        el('td',{},el('span',{class:'badge'},p.state)),
        el('td',{},[
          (()=>{
            const b1 = el('button',{class:'btn'},'Issue ticket');
            b1.addEventListener('click', ()=> issueTicket(p.id));
            const actions = [b1, ' '];
            if(p.state!=='purchased'){
              const b2 = el('button',{class:'btn'},'Mark purchased');
              b2.addEventListener('click', ()=> markPurchased(p.id));
              actions.push(b2);
            }
            return actions;
          })()
        ])
      ]);
      tbody.appendChild(tr);
    });
  }
  productSelect.innerHTML = '<option value="">— Оберіть продукт —</option>';
  list.forEach(p=>{
    const opt = el('option',{value:p.id}, `${p.id} — ${p.meta.name} [${p.state}]`);
    productSelect.appendChild(opt);
  });
  issueBtn.disabled = !productSelect.value;
}
loadProducts();

async function markPurchased(id){
  try{
    const res = await fetch(`${API}/api/products/${id}/purchase`, {method:'POST'});
    const j = await res.json();
    if(!res.ok) throw new Error(j.error || 'Failed');
    await loadProducts();
  }catch(e){ alert(e.message) }
}
productSelect.addEventListener('change', ()=>{ issueBtn.disabled = !productSelect.value; });

// Issue claim
const ticketBlock = $('#ticketBlock');
const ticketQR = new QRCode(document.getElementById('ticketQR'), {text:'', width:180, height:180});

async function issueTicket(id){
  try{
    const res = await fetch(`${API}/api/claim/issue`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tokenId: Number(id), to: 'buyer@example.com', ttlSeconds: 24*3600 })
    });
    const j = await res.json();
    if(!res.ok) throw new Error(j.error || 'Issue failed');

    ticketBlock.classList.remove('hidden');
    $('#ticketId').textContent = j.ticketId;
    $('#ticketToken').textContent = j.tokenId;
    $('#ticketExp').textContent = new Date(j.exp*1000).toLocaleString();
    $('#ticketPayload').textContent = JSON.stringify(j.payload, null, 2);
    ticketQR.clear();
    ticketQR.makeCode(JSON.stringify(j.payload));

    await loadProducts();
  }catch(e){ alert(e.message) }
}
issueBtn.addEventListener('click', ()=>{ if(productSelect.value) issueTicket(productSelect.value); });

// User: scan & verify
const openCam = $('#openCam');
const stopCam = $('#stopCam');
const readerBox = $('#reader');
const payloadText = $('#payloadText');
const checkBtn = $('#checkBtn');

let scanner = null;
openCam.addEventListener('click', async ()=>{
  try{
    readerBox.style.height = '280px';
    openCam.disabled = true; stopCam.disabled = false;
    scanner = new Html5Qrcode("reader");
    const config = { fps:10, qrbox:{width:240,height:240} };
    await scanner.start({ facingMode:"environment" }, config,
      (text)=>{
        payloadText.value = text;
        verifyPayload(text);
        stopCamera();
      },
      ()=>{}
    );
  }catch(e){
    alert('Не вдалося запустити камеру (дозволи/HTTPS/localhost).');
    resetCameraUI();
  }
});
stopCam.addEventListener('click', stopCamera);
function stopCamera(){
  if(scanner){ scanner.stop().catch(()=>{}); scanner.clear(); scanner=null; }
  resetCameraUI();
}
function resetCameraUI(){
  readerBox.style.height = '0px';
  openCam.disabled = false; stopCam.disabled = true;
}

checkBtn.addEventListener('click', ()=> verifyPayload(payloadText.value));

async function verifyPayload(raw){
  try{
    const payload = JSON.parse(raw);
    if(payload.t==='prod'){
      const res = await fetch(`${API}/api/verify/${payload.id}`);
      const j = await res.json();
      if(!res.ok) throw new Error(j.error || 'Verify failed');

      const msg =
        j.state==='claimed'   ? 'Справжній (у вас)' :
        j.state==='purchased' ? 'Придбано (можливо не ваше)' :
        j.state==='created'   ? 'Створено, але не придбано' : 'Невідомо';

      const detailsLink = `<a href="${API}/details.html?id=${encodeURIComponent(j.tokenId)}" target="_blank" rel="noopener">Відкрити деталі</a>`;
      showResult('ok', [
        `<b>${msg}</b>`,
        `<div class="mono">TokenId: ${j.tokenId}</div>`,
        `<div>Назва: ${j.metadata.name}</div>`,
        `<div class="mono">Серійний: ${j.metadata.serial}</div>`,
        `<div style="margin-top:6px">${detailsLink}</div>`
      ].join('<br>'));

    } else if(payload.t==='claim'){
      const res = await fetch(`${API}/api/claim/redeem`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ payload })
      });
      const j = await res.json();
      if(!res.ok) throw new Error(j.error || 'Redeem failed');
      showResult('ok', `<b>NFT успішно забрано</b><br>Стан: ${j.state}`);
      await loadProducts();
    } else {
      showResult('bad', 'Невідомий тип QR');
    }
  }catch(e){
    showResult('bad', 'Помилка: ' + e.message);
  }
}