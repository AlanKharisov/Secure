// docs/auth-ui.js
// UI авторизации: сокращённый email, фото, панель входа, бейдж бренда (пер-почтовый кэш)
// Минималистичный и устойчивый UI авторизации.
// Ожидает элементы с id: #authEmail, #authPhoto, #loginBtn, #logoutBtn,
// #authPanel, #gLogin, #email, #password, #emailSignIn, #emailSignUp, #authErr, #accountLink

(function () {
  function setupAuthUI(scope = document) {
    const $ = (s) => scope.querySelector(s);

    const emailEl = $("#authEmail");
    const photoEl = $("#authPhoto");
    const login   = $("#loginBtn");
    const logout  = $("#logoutBtn");
    const panel   = $("#authPanel");
    const gLogin  = $("#gLogin");
    const emailIn = $("#email");
    const passIn  = $("#password");
    const emailSignIn = $("#emailSignIn");
    const emailSignUp = $("#emailSignUp");
    const errBox  = $("#authErr");
    const accountLink = $("#accountLink");

    // Скрываем часть email на экране
    const maskEmail = (e) => {
      if (!e) return "";
      const [name, dom] = e.split("@");
      if (!dom) return e;
      if (name.length <= 3) return name + "@" + dom;
      return (name.slice(0, 2) + "…" + name.slice(-1)) + "@" + dom;
    };

    function showErr(msg) {
      if (!errBox) return;
      errBox.style.display = "block";
      errBox.textContent = msg;
    }
    function clearErr() {
      if (!errBox) return;
      errBox.style.display = "none";
      errBox.textContent = "";
    }

    function setUser(u) {
      clearErr();
      if (u) {
        if (emailEl) emailEl.textContent = maskEmail(u.email || u.uid);
        if (photoEl) {
          if (u.photoURL) { photoEl.src = u.photoURL; photoEl.style.display = "inline-block"; }
          else { photoEl.style.display = "none"; }
        }
        if (login)  login.style.display = "none";
        if (logout) logout.style.display = "inline-block";
        if (panel)  panel.classList.add("hidden");
        if (accountLink) accountLink.style.display = "inline-block";
      } else {
        if (emailEl) emailEl.textContent = "";
        if (photoEl) photoEl.style.display = "none";
        if (login)  login.style.display = "inline-block";
        if (logout) logout.style.display = "none";
        if (accountLink) accountLink.style.display = "none";
      }
    }

    document.addEventListener("auth-changed", (e) => setUser(e.detail));
    if (window.Auth) setUser(window.Auth.user); // первичная инициализация

    login?.addEventListener("click", () => { panel?.classList.toggle("hidden"); clearErr(); });
    logout?.addEventListener("click", () => window.Auth?.signOut().catch((e) => showErr(e.message)));

    gLogin?.addEventListener("click", async () => {
      try { await window.Auth?.signInGoogle(); }
      catch (e) { showErr(e.message); }
    });

    emailSignIn?.addEventListener("click", async () => {
      try {
        clearErr();
        await window.Auth?.signInEmail((emailIn?.value || "").trim(), (passIn?.value || "").trim());
      } catch (e) { showErr(e.message); }
    });
    emailSignUp?.addEventListener("click", async () => {
      try {
        clearErr();
        await window.Auth?.signUpEmail((emailIn?.value || "").trim(), (passIn?.value || "").trim());
      } catch (e) { showErr(e.message); }
    });

    // клик вне панели — закрыть
    document.addEventListener("click", (ev) => {
      if (!panel || panel.classList.contains("hidden")) return;
      const inside = panel.contains(ev.target) || (login && login.contains(ev.target));
      if (!inside) panel.classList.add("hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", () => setupAuthUI(document));
})();
