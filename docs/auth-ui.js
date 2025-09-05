;(function () {
  "use strict";

  // --- helpers ---
  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function setText(el, txt) { if (el) el.textContent = txt == null ? "" : String(txt); }
  function show(el, on) { if (!el) return; el.style.display = on ? "" : "none"; }
  function esc(s) {
    s = s == null ? "" : String(s);
    return s.replace(/[&<>"']/g, function (m) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
    });
  }
  function compactEmail(email) {
    if (!email) return "";
    var parts = email.split("@");
    if (parts.length < 2) return email;
    var name = parts[0];
    var domain = parts[1];
    var short = name.length > 3 ? (name.slice(0, 2) + "…") : name;
    return short + "@" + domain;
  }
  function fetchJSON(url, opts) {
    opts = opts || {};
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(t || ("HTTP " + res.status));
        });
      }
      var ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") === -1) return {};
      return res.json();
    });
  }

  // --- dom refs (можуть бути відсутні на деяких сторінках — все ок) ---
  var emailEl = $("#authEmail");
  var photoEl = $("#authPhoto");
  var loginBtn = $("#loginBtn");
  var logoutBtn = $("#logoutBtn");
  var authPanel = $("#authPanel");
  var gLogin = $("#gLogin");
  var emailIn = $("#email");
  var passIn = $("#password");
  var emailSignIn = $("#emailSignIn");
  var emailSignUp = $("#emailSignUp");
  var errBox = $("#authErr");
  var accountLink = $("#accountLink");

  // чіпси брендів у хедері та на сторінці акаунта
  var brandChipsHeader = $("#brandChips");
  var brandChipsProfile = $("#pBrands");

  // вкладки (можуть бути лише на index.html)
  var adminTab = $("#adminTab");
  var manufTab = $("#manufTab");
  var userTab  = $("#userTab");

  // елементи профілю (на account.html)
  var pPhoto = $("#pPhoto");
  var pName  = $("#pName");
  var pEmail = $("#pEmail");

  // --- конфіг з window (встановлюється в config.js або беком) ---
  var API = window.API_BASE || window.location.origin;
  var CLIENT_ADMINS = window.CLIENT_ADMINS instanceof Set ? window.CLIENT_ADMINS : new Set();
  var EMAIL_BRANDS = window.EMAIL_BRANDS || {};
  var CLIENT_MANUFACTURERS = window.CLIENT_MANUFACTURERS instanceof Set ? window.CLIENT_MANUFACTURERS : new Set();

  // --- state ---
  var CURRENT_ROLES = { email: "", isAdmin: false, isManufacturer: false, brands: [] };

  function showErr(msg) {
    if (!errBox) return;
    errBox.style.display = "block";
    setText(errBox, msg);
  }
  function clearErr() {
    if (!errBox) return;
    errBox.style.display = "none";
    setText(errBox, "");
  }

  // --- бренди користувача (бек → фолбек config.js) ---
  function fetchMyBrands(email) {
    if (!email) return Promise.resolve([]);
    var url = API + "/api/manufacturers?owner=" + encodeURIComponent(email);
    return fetchJSON(url, { headers: { "X-User": email } })
      .then(function (j) {
        if (Array.isArray(j)) return j;
        return [];
      })
      .catch(function () {
        if (EMAIL_BRANDS[email]) return EMAIL_BRANDS[email];
        if (CLIENT_MANUFACTURERS.has(email)) {
          return [{ name: "Your Brand", slug: "YOUR-BRAND", verified: false }];
        }
        return [];
      });
  }

  function renderBrandChips(list) {
    function renderInto(container) {
      if (!container) return;
      container.innerHTML = "";
      if (!list || !list.length) {
        var span = document.createElement("span");
        span.className = "muted small";
        span.textContent = "— у вас немає брендів —";
        container.appendChild(span);
        return;
      }
      list.forEach(function (b) {
        var chip = document.createElement("span");
        chip.className = "badge";
        chip.textContent = b.name + (b.verified ? " ✓" : "");
        container.appendChild(chip);
      });
    }
    renderInto(brandChipsHeader);
    renderInto(brandChipsProfile);
  }

  function setTabsVisibility(isAdmin, isManufacturer) {
    if (adminTab) adminTab.style.display = isAdmin ? "" : "none";
    if (manufTab) manufTab.style.display = isManufacturer ? "" : "none";

    // якщо активна вкладка стала прихованою — вмикаємо "Користувач"
    var active = document.querySelector(".tab.active");
    var needSwitch = false;
    if (active === adminTab && !isAdmin) needSwitch = true;
    if (active === manufTab && !isManufacturer) needSwitch = true;

    if (needSwitch) {
      if (active) active.classList.remove("active");
      if (userTab) {
        userTab.classList.add("active");
        var userPane = $("#user");
        var others = document.querySelectorAll(".tabpane");
        for (var i = 0; i < others.length; i++) others[i].classList.remove("active");
        if (userPane) userPane.classList.add("active");
      }
    }
  }

  function onUserChange(u) {
    clearErr();

    if (u) {
      // header
      setText(emailEl, compactEmail(u.email));
      if (photoEl) {
        if (u.photoURL) { photoEl.src = u.photoURL; show(photoEl, true); }
        else show(photoEl, false);
      }
      show(loginBtn, false);
      show(logoutBtn, true);
      if (authPanel) authPanel.classList.add("hidden");
      show(accountLink, true);

      // account page
      if (pName)  setText(pName, u.displayName || u.email || u.uid);
      if (pEmail) setText(pEmail, u.email || "");
      if (pPhoto) {
        if (u.photoURL) { pPhoto.src = u.photoURL; show(pPhoto, true); }
        else show(pPhoto, false);
      }

      var email = u.email || u.uid;
      var isAdmin = CLIENT_ADMINS.has(email);

      fetchMyBrands(email).then(function (brands) {
        var isManufacturer = Array.isArray(brands) && brands.length > 0;

        renderBrandChips(brands);
        setTabsVisibility(isAdmin, isManufacturer);

        CURRENT_ROLES = { email: email, isAdmin: isAdmin, isManufacturer: isManufacturer, brands: brands };
        document.dispatchEvent(new CustomEvent("roles-ready", { detail: CURRENT_ROLES }));
      });
    } else {
      // header
      setText(emailEl, "");
      show(photoEl, false);
      show(loginBtn, true);
      show(logoutBtn, false);
      show(accountLink, false);
      if (authPanel) authPanel.classList.add("hidden");

      // account page
      setText(pName, "");
      setText(pEmail, "");
      show(pPhoto, false);

      renderBrandChips([]);
      setTabsVisibility(false, false);

      CURRENT_ROLES = { email: "", isAdmin: false, isManufacturer: false, brands: [] };
      document.dispatchEvent(new CustomEvent("roles-ready", { detail: CURRENT_ROLES }));
    }
  }

  // --- events ---
  document.addEventListener("auth-changed", function (e) {
    onUserChange(e.detail);
  });

  if (loginBtn) {
    loginBtn.addEventListener("click", function () {
      if (authPanel) authPanel.classList.toggle("hidden");
      clearErr();
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      if (window.Auth && window.Auth.signOut) {
        window.Auth.signOut().catch(function (e) { showErr(e.message); });
      }
    });
  }
  if (gLogin) {
    gLogin.addEventListener("click", function () {
      if (window.Auth && window.Auth.signInGoogle) {
        window.Auth.signInGoogle().catch(function (e) { showErr(e.message); });
      }
    });
  }
  if (emailSignIn) {
    emailSignIn.addEventListener("click", function () {
      clearErr();
      var em = (emailIn && emailIn.value || "").trim();
      var pw = (passIn && passIn.value || "").trim();
      if (window.Auth && window.Auth.signInEmail) {
        window.Auth.signInEmail(em, pw).catch(function (e) { showErr(e.message); });
      }
    });
  }
  if (emailSignUp) {
    emailSignUp.addEventListener("click", function () {
      clearErr();
      var em = (emailIn && emailIn.value || "").trim();
      var pw = (passIn && passIn.value || "").trim();
      if (window.Auth && window.Auth.signUpEmail) {
        window.Auth.signUpEmail(em, pw).catch(function (e) { showErr(e.message); });
      }
    });
  }

  // клік поза панеллю — сховати її
  document.addEventListener("click", function (ev) {
    if (!authPanel || authPanel.classList.contains("hidden")) return;
    var inside = authPanel.contains(ev.target) || (loginBtn && loginBtn.contains(ev.target));
    if (!inside) authPanel.classList.add("hidden");
  });

  // якщо вже авторизований — одразу відмалюємо
  if (window.Auth && window.Auth.user) onUserChange(window.Auth.user);
})();
