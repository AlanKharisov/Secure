(function () {
  var $ = function (s, sc) { return (sc || document).querySelector(s); };

  var emailEl = $("#authEmail");
  var photoEl = $("#authPhoto");
  var login   = $("#loginBtn");
  var logout  = $("#logoutBtn");
  var panel   = $("#authPanel");
  var gLogin  = $("#gLogin");
  var emailIn = $("#email");
  var passIn  = $("#password");
  var emailSignIn = $("#emailSignIn");
  var emailSignUp = $("#emailSignUp");
  var errBox  = $("#authErr");
  var accountLink = $("#accountLink");
  var brandChips = $("#brandChips");

  var adminTab = $("#adminTab");
  var manufTab = $("#manufTab");
  var userTab  = $("#userTab");

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
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") === -1) return null;
      return res.json();
    });
  }

  function fetchMyBrands(email) {
    if (!email) return Promise.resolve([]);
    // 1) бекенд
    var url = (window.API_BASE || window.location.origin) + "/api/manufacturers?owner=" + encodeURIComponent(email);
    return fetchJSON(url, { headers: { "X-User": email } }).then(function (j) {
      if (Array.isArray(j)) return j;
      return [];
    }).catch(function(){
      // 2) config.js
      if (window.EMAIL_BRANDS && window.EMAIL_BRANDS[email]) {
        return window.EMAIL_BRANDS[email];
      }
      // 3) fallback: виробник без брендів
      if (window.CLIENT_MANUFACTURERS && window.CLIENT_MANUFACTURERS.has(email)) {
        return [{ name: "Your Brand", slug: "YOUR-BRAND", verified: false }];
      }
      return [];
    });
  }

  function renderBrandChips(list) {
    if (!brandChips) return;
    brandChips.innerHTML = "";
    if (!list || !list.length) {
      var span = document.createElement("span");
      span.className = "muted small";
      span.textContent = "— у вас немає брендів —";
      brandChips.appendChild(span);
      return;
    }
    list.forEach(function(b){
      var chip = document.createElement("span");
      chip.className = "badge";
      chip.textContent = b.name + (b.verified ? " ✓" : "");
      brandChips.appendChild(chip);
    });
  }

  function setTabsVisibility(isAdmin, isManufacturer) {
    if (adminTab) adminTab.style.display = isAdmin ? "" : "none";
    if (manufTab) manufTab.style.display = isManufacturer ? "" : "none";
    var anyActive = document.querySelector(".tab.active");
    if (!anyActive && userTab) userTab.classList.add("active");
  }

  function onUserChange(u){
    clearErr();
    if (u) {
      if (emailEl) emailEl.textContent = compactEmail(u.email);
      if (photoEl) {
        if (u.photoURL) { photoEl.src = u.photoURL; photoEl.style.display = "inline-block"; }
        else photoEl.style.display = "none";
      }
      if (login)  login.style.display = "none";
      if (logout) logout.style.display = "inline-block";
      if (panel)  panel.classList.add("hidden");
      if (accountLink) accountLink.style.display = "inline-block";

      var email = u.email || u.uid;

      var isAdmin = !!(window.CLIENT_ADMINS && window.CLIENT_ADMINS.has && window.CLIENT_ADMINS.has(email));

      fetchMyBrands(email).then(function(brands){
        var isManufacturer = Array.isArray(brands) && brands.length > 0;

        renderBrandChips(brands);
        setTabsVisibility(isAdmin, isManufacturer);

        document.dispatchEvent(new CustomEvent("roles-ready", {
          detail: { email: email, isAdmin: isAdmin, isManufacturer: isManufacturer, brands: brands }
        }));
      });
    } else {
      if (emailEl) emailEl.textContent = "";
      if (photoEl) photoEl.style.display = "none";
      if (login)  login.style.display = "inline-block";
      if (logout) logout.style.display = "none";
      if (accountLink) accountLink.style.display = "none";
      renderBrandChips([]);
      setTabsVisibility(false, false);
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
