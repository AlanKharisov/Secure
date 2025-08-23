// docs/auth-ui.js
(function(){
    function setupAuthUI(scope=document){
        const $ = (s)=>scope.querySelector(s);

        const emailEl = $('#authEmail');
        const photoEl = $('#authPhoto');
        const login   = $('#loginBtn');
        const logout  = $('#logoutBtn');
        const panel   = $('#authPanel');
        const gLogin  = $('#gLogin');
        const emailIn = $('#email');
        const passIn  = $('#password');
        const emailSignIn = $('#emailSignIn');
        const emailSignUp = $('#emailSignUp');
        const errBox  = $('#authErr');
        const accountLink = $('#accountLink'); // ← нове: посилання “Мій акаунт”

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
                if (emailEl) emailEl.textContent = u.email || u.displayName || u.uid;
                if (photoEl) {
                    if (u.photoURL) { photoEl.src = u.photoURL; photoEl.style.display='inline-block'; }
                    else photoEl.style.display='none';
                }
                if (login)  login.style.display = 'none';
                if (logout) logout.style.display = 'inline-block';
                if (panel)  panel.classList.add('hidden');
                if (accountLink) accountLink.style.display = 'inline-block'; // показати “Мій акаунт”
            } else {
                if (emailEl) emailEl.textContent = '';
                if (photoEl) photoEl.style.display='none';
                if (login)  login.style.display = 'inline-block';
                if (logout) logout.style.display = 'none';
                if (accountLink) accountLink.style.display = 'none';
            }
        }

        document.addEventListener('auth-changed', e => setUser(e.detail));
        if (window.Auth) setUser(window.Auth.user);

        login?.addEventListener('click', ()=>{
            panel?.classList.toggle('hidden');
            clearErr();
        });
        logout?.addEventListener('click', ()=> window.Auth?.signOut().catch(e=>showErr(e.message)));

        gLogin?.addEventListener('click', async ()=>{
            try { await window.Auth?.signInGoogle(); }
            catch(e){ showErr(e.message); }
        });

        emailSignIn?.addEventListener('click', async ()=>{
            try {
                clearErr();
                await window.Auth?.signInEmail((emailIn?.value||'').trim(), (passIn?.value||'').trim());
            } catch(e){ showErr(e.message); }
        });
        emailSignUp?.addEventListener('click', async ()=>{
            try {
                clearErr();
                await window.Auth?.signUpEmail((emailIn?.value||'').trim(), (passIn?.value||'').trim());
            } catch(e){ showErr(e.message); }
        });

        document.addEventListener('click', (ev)=>{
            if (!panel || panel.classList.contains('hidden')) return;
            const inside = panel.contains(ev.target) || (login && login.contains(ev.target));
            if (!inside) panel.classList.add('hidden');
        });
    }

    document.addEventListener('DOMContentLoaded', ()=> setupAuthUI(document));
})();