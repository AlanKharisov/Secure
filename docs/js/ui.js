// docs/js/ui.js
function toast(msg){
    let t = document.querySelector(".toast");
    if(!t){ t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(()=> t.classList.remove("show"), 2000);
}

function copyText(txt){ navigator.clipboard.writeText(txt).then(()=> toast("Скопійовано")); }
function dl(filename, text){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text],{type:"application/json"}));
    a.download = filename; a.click();
}

function renderNav(active=""){
    const nav = document.querySelector(".nav");
    if(!nav){ return; }
    const u = (window.API?.getUser && API.getUser()) || "";
    nav.innerHTML = `
    <div class="links">
      <a href="./index.html"${active==="home"?' style="text-decoration:underline"':''}>Головна</a>
      <a href="./products.html"${active==="products"?' style="text-decoration:underline"':''}>Продукти</a>
      <a href="./admins.html"${active==="admins"?' style="text-decoration:underline"':''}>Адміни</a>
    </div>
    <div class="input-inline">
      <input id="emailBox" placeholder="you@example.com" value="${u||""}" />
      <button id="saveUserBtn" class="secondary">Set X-User</button>
    </div>
  `;
    document.getElementById("saveUserBtn").onclick = () => {
        API.setUser(document.getElementById("emailBox").value.trim());
        toast("X-User оновлено");
        if (typeof window.onUserChanged === "function") window.onUserChanged();
    };
}

window.toast = toast;
window.copyText = copyText;
window.dl = dl;
window.renderNav = renderNav;
