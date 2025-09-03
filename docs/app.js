(function(){
  function setupAuthUI(scope) {
    if (!scope) scope = document;

    function $(s){ return scope.querySelector(s); }

    var emailEl = $('#authEmail');
    var photoEl = $('#authPhoto');
    var login   = $('#loginBtn');
    var logout  = $('#logoutBtn');
    var panel   = $('#authPanel');
    var gLogin  = $('#gLogin');
    var emailIn = $('#email');
    var passIn  = $('#password');
    var emailSignIn = $('#emailSignIn');
    var emailSignUp = $('#emailSignUp');
    var errBox  = $('#authErr');
    var accountLink = $('#accountLink');

    function showErr(msg){
      if (!errBox) return;
      errBox.style.display = 'block';
      errBox.textContent = msg;
    }
    function clearErr(){
      if (!errBox) return;
      errBox.style.display = 'none';
      errBox.textContent = '';
    }
    function setUser(u){
      clearErr();
      if (u) {
        if (emailEl) emailEl.textContent = u.email || u.displayName || u.uid || '';
        if (photoEl) {
          if (u.photoURL) { photoEl.src = u.photoURL; photoEl.style.display='inline-block'; }
          else photoEl.style.display='none';
        }
        if (login)  login.style.display = 'none';
        if (logout) logout.style.display = 'inline-block';
        if (panel)  panel.classList.add('hidden');
        if (accountLink) accountLink.style.display = 'inline-block';
      } else {
        if (emailEl) emailEl.textContent = '';
        if (photoEl) photoEl.style.display='none';
        if (login)  login.style.display = 'inline-block';
        if (logout) logout.style.display = 'none';
        if (accountLink) accountLink.style.display = 'none';
      }
    }

    document.addEventListener('auth-changed', function(e){
      setUser(e.detail);
    });
    if (window.Auth) setUser(window.Auth.user);

    if (login) {
      login.addEventListener('click', function(){
        if (!panel) return;
        if (panel.classList.contains('hidden')) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
        clearErr();
      });
    }
    if (logout) {
      logout.addEventListener('click', function(){
        if (window.Auth && window.Auth.signOut) {
          window.Auth.signOut().catch(function(e){ showErr(e.message); });
        }
      });
    }
    if (gLogin) {
      gLogin.addEventListener('click', function(){
        if (window.Auth && window.Auth.signInGoogle) {
          window.Auth.signInGoogle().catch(function(e){ showErr(e.message); });
        }
      });
    }
    if (emailSignIn) {
      emailSignIn.addEventListener('click', function(){
        try {
          clearErr();
          var em = (emailIn && emailIn.value) ? String(emailIn.value).trim() : '';
          var pw = (passIn && passIn.value) ? String(passIn.value).trim() : '';
          if (window.Auth && window.Auth.signInEmail) {
            window.Auth.signInEmail(em, pw).catch(function(e){ showErr(e.message); });
          }
        } catch(e){ showErr(e.message); }
      });
    }
    if (emailSignUp) {
      emailSignUp.addEventListener('click', function(){
        try {
          clearErr();
          var em = (emailIn && emailIn.value) ? String(emailIn.value).trim() : '';
          var pw = (passIn && passIn.value) ? String(passIn.value).trim() : '';
          if (window.Auth && window.Auth.signUpEmail) {
            window.Auth.signUpEmail(em, pw).catch(function(e){ showErr(e.message); });
          }
        } catch(e){ showErr(e.message); }
      });
    }

    document.addEventListener('click', function(ev){
      if (!panel || panel.classList.contains('hidden')) return;
      var inside = panel.contains(ev.target) || (login && login.contains(ev.target));
      if (!inside) panel.classList.add('hidden');
    });
  }

  document.addEventListener('DOMContentLoaded', function(){ setupAuthUI(document); });
})();
