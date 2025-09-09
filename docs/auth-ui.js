(function () {
  "use strict";

  function $(s, sc){ return (sc || document).querySelector(s); }
  function compactEmail(email) {
    if (!email) return "";
    var parts = email.split("@");
    if (parts.length < 2) return email;
    var name = parts[0], domain = parts[1];
    var short = name.length > 3 ? (name.slice(0,2) + "…") : name;
    return short + "@" + domain;
  }
  function fetchJSON(url, opts, expectJson) {
    if (opts === void 0) opts = {};
    if (expectJson === void 0) expectJson = true;
    return fetch(url, opts).then(function(res){
      if (!res.ok) return res.text().then(function(t){ throw new Error(t || ("HTTP " + res.status)); });
      if (!expectJson) return null;
      var ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") === -1) return null;
      return res.json();
    });
  }
  function authUser(){ return (window.Auth && window.Auth.user) ? (window.Auth.user.email || window.Auth.user.uid) : ""; }
  function authHeaders(){ var u = authUser(); return u ? { "X-User": u } : {}; }

  // два набори елементів (для різних сторінок)
  var emailEl   = $("#authEmail");
  var photoEl   = $("#authPhoto");
  var pEmailEl  = $("#pEmail");
  var pNameEl   = $("#pName");
  var pPhotoEl  = $("#pPhoto");

  var login   = $("#loginBtn");
  var logout  = $("#logoutBtn");
  var panel   = $("#authPanel");
  var gLogin  = $("#gLogin");
  var emailIn = $("#email");
  var passIn  = $("#password");
  var emailSignIn = $("#emailSignIn");
  var emailSignUp = $("#emailSignUp");
  var errBox  = $("#authErr");

  function showErr(msg){
    if (!errBox) return;
    errBox.style.display = "block";
    errBox.textContent = msg;
  }
  function clearErr(){ if (errBox){ errBox.style.display = "none"; errBox.textContent = ""; } }

  function renderHeaderUser(u){
    if (emailEl) emailEl.textContent = compactEmail(u?.email || u?.uid || "");
    if (photoEl) {
      if (u && u.photoURL) { photoEl.src = u.photoURL; photoEl.style.display = "inline-block"; }
      else photoEl.style.display = "none";
    }
    if (pEmailEl) pEmailEl.textContent = (u?.email || "");
    if (pNameEl)  pNameEl.textContent  = (u?.displayName || u?.email || "");
    if (pPhotoEl) {
      if (u && u.photoURL) { pPhotoEl.src = u.photoURL; pPhotoEl.style.display = "inline-block"; }
      else pPhotoEl.style.display = "none";
    }
  }

  function onUserChange(u){
    clearErr();
    if (u) {
      renderHeaderUser(u);
      if (login)  login.style.display = "none";
      if (logout) logout.style.display = "inline-block";
      if (panel)  panel.classList.add("hidden");

      // /api/me -> бренди/ролі
      var url = (window.API_BASE || window.location.origin) + "/api/me";
      fetchJSON(url, { headers: authHeaders() })
        .then(function(me){
          var brands = Array.isArray(me.brands) ? me.brands : [];
          // повідомляємо інші скрипти
          document.dispatchEvent(new CustomEvent("roles-ready", {
            detail: { email: u.email || u.uid, isAdmin: !!me.isAdmin, isManufacturer: brands.length > 0, brands: brands }
          }));
        })
        .catch(function(){
          document.dispatchEvent(new CustomEvent("roles-ready", {
            detail: { email: u.email || u.uid, isAdmin: false, isManufacturer: false, brands: [] }
          }));
        });
    } else {
      if (emailEl) emailEl.textContent = "";
      if (photoEl) photoEl.style.display = "none";
      if (pEmailEl) pEmailEl.textContent = "";
      if (pNameEl)  pNameEl.textContent  = "";
      if (pPhotoEl) pPhotoEl.style.display = "none";

      if (login)  login.style.display = "inline-block";
      if (logout) logout.style.display = "none";
      document.dispatchEvent(new CustomEvent("roles-ready", {
        detail: { email:"", isAdmin:false, isManufacturer:false, brands:[] }
      }));
    }
  }

  document.addEventListener("auth-changed", function(e){ onUserChange(e.detail); });

  if (login) {
    login.addEventListener("click", function(){
      if (panel) panel.classList.toggle("hidden");
      clearErr();
    });
  }
  if (logout) {
    logout.addEventListener("click", function(){
      if (window.Auth && window.Auth.signOut) {
        window.Auth.signOut().catch(function(e){ showErr(e.message); });
      }
    });
  }
  if (gLogin) {
    gLogin.addEventListener("click", function(){
      if (window.Auth && window.Auth.signInGoogle) {
        window.Auth.signInGoogle().catch(function(e){ showErr(e.message); });
      }
    });
  }
  if (emailSignIn) {
    emailSignIn.addEventListener("click", function(){
      clearErr();
      var em = (emailIn && emailIn.value || "").trim();
      var pw = (passIn && passIn.value || "").trim();
      if (window.Auth && window.Auth.signInEmail) {
        window.Auth.signInEmail(em, pw).catch(function(e){ showErr(e.message); });
      }
    });
  }
  if (emailSignUp) {
    emailSignUp.addEventListener("click", function(){
      clearErr();
      var em = (emailIn && emailIn.value || "").trim();
      var pw = (passIn && passIn.value || "").trim();
      if (window.Auth && window.Auth.signUpEmail) {
        window.Auth.signUpEmail(em, pw).catch(function(e){ showErr(e.message); });
      }
    });
  }

  document.addEventListener("click", function(ev){
    if (!panel || panel.classList.contains("hidden")) return;
    var inside = panel.contains(ev.target) || (login && login.contains(ev.target));
    if (!inside) panel.classList.add("hidden");
  });

  if (window.Auth && window.Auth.user) onUserChange(window.Auth.user);
})();
