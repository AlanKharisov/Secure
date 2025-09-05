(function(){
  "use strict";
  var API = window.API_BASE || window.location.origin;
  var $ = function(s, sc){ return (sc||document).querySelector(s); };
  function esc(s){ return (s==null?"":String(s)).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function authUser(){ return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
  function authHeaders(){ var u = authUser(); return u ? { "X-User": u } : {}; }

  var qs = new URLSearchParams(location.search);
  var id = qs.get("id");

  async function load(){
    var box = $("#content");
    if (!box) return;
    if (!id){ box.innerHTML = '<div class="result bad">Немає id</div>'; return; }

    try{
      var r = await fetch(API + "/api/verify/" + encodeURIComponent(id), { headers: authHeaders() });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || "Not found");

      var imgHTML = (j.metadata.image||"").trim()
        ? '<img class="prodimg" src="'+ esc(j.metadata.image) +'" alt="Фото">'
        : '<div class="muted">Немає зображення</div>';

      var isFull = j.scope === "full";
      var serial = isFull ? esc(j.metadata.serial) : "приховано";
      var ipfs   = isFull ? esc(j.ipfsHash || "-") : "приховано";
      var serialHash = isFull ? esc(j.serialHash || "-") : "приховано";

      var buyBtn = (!isFull && j.state === "created")
        ? '<div style="margin-top:12px"><button id="buyBtn" class="btn primary">Купити (отримати у власність)</button></div>'
        : '';

      var certs = (j.metadata.certificates || []);
      var certsHTML = certs.length
        ? certs.map(c=>'<span class="badge">'+ esc(c) +'</span>').join(" ")
        : '<span class="muted">немає</span>';

      box.innerHTML =
        '<div class="hero">'+
          '<div class="imgwrap">'+ imgHTML +'</div>'+
          '<div class="info">'+
            '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between">'+
              '<h2 style="margin:0">'+ esc(j.metadata.name) +'</h2>'+
              '<span class="badge">'+ esc(j.state) +'</span>'+
            '</div>'+
            '<div class="mono" style="margin-top:6px">TokenId: '+ esc(String(j.tokenId)) +'</div>'+
            '<div class="mono">Serial: '+ serial +'</div>'+
            '<div class="mono">SerialHash: '+ serialHash +'</div>'+
            '<div class="mono">IPFS: '+ ipfs +'</div>'+
            '<div>Вироблено: '+ esc(j.metadata.manufacturedAt || "-") +'</div>'+
            '<div style="margin-top:10px">Сертифікати: '+ certsHTML +'</div>'+
            buyBtn+
          '</div>'+
        '</div>';

      var btn = $("#buyBtn");
      if (btn){
        btn.addEventListener("click", async function(){
          var u = window.Auth && window.Auth.user;
          if (!u){ alert("Увійдіть, будь ласка."); return; }
          btn.disabled = true;
          try{
            var resp = await fetch(API + "/api/products/" + encodeURIComponent(j.tokenId) + "/purchase", {
              method: "POST",
              headers: Object.assign({ "Content-Type":"application/json" }, authHeaders()),
              body: "{}"
            });
            var ok = await resp.json();
            if (!resp.ok) throw new Error(ok.error || "error");
            alert("Готово! Ви стали власником. Перезавантажую сторінку…");
            location.reload();
          }catch(e){
            alert(e.message);
          }finally{
            btn.disabled = false;
          }
        });
      }
    }catch(e){
      var box2 = $("#content");
      if (box2) box2.innerHTML = '<div class="result bad">Помилка: '+ esc(e.message) +'</div>';
    }
  }

  document.addEventListener("auth-changed", load);
  document.addEventListener("DOMContentLoaded", load);
})();
