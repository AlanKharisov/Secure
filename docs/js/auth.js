const form = document.getElementById('login-form');
const toReg = document.getElementById('to-register');

form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    try {
        await api('/api/login', { method:'POST', body: JSON.stringify({ email, password }) });
    } catch(err) {
        try {
            await api('/api/register', { method:'POST', body: JSON.stringify({ email, password }) });
        } catch(e2) { return alert(e2.message) }
    }
    location.href = '/dashboard.html';
});

if (toReg) toReg.addEventListener('click', (e)=>{ e.preventDefault(); form.dispatchEvent(new Event('submit')); });
