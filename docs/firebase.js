// docs/firebase.js — Google Sign-In (popup з fallback у redirect) + детальне логування
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  getIdToken,
  signOut as fbSignOut,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ⚠️ Твій реальний Firebase-конфіг (вже ок)
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.firebasestorage.app",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Персистенс у браузері (щоб тримало сесію між перезавантаженнями)
await setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.warn("[Auth] setPersistence warn:", e?.code, e?.message);
});

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// Додаткові скоупи не обов’язкові, але приклад:
// provider.addScope("email");
// provider.addScope("profile");

// Допоміжна: красивий лог помилок
function logAuthError(where, err) {
  const code = err?.code || "";
  const msg  = err?.message || String(err);
  console.error(`[Auth] ${where} error:`, code, msg, err);
  return code;
}

// Публічний API для решти фронту
export const Auth = {
  user: null,

 let signingIn = false;

export const Auth = {
  user: null,

  async signIn() {
    if (signingIn) {
      console.log("[Auth] signIn skipped: already in progress");
      return;
    }
    signingIn = true;
    console.log("[Auth] signIn() start (popup)…");
    try {
      await signInWithPopup(auth, provider);
      console.log("[Auth] popup success");
    } catch (err) {
      const code = err?.code || "";
      console.warn("[Auth] popup error:", code, err?.message || err);

      // Автоматичний fallback у redirect для типових кейсів
      const shouldFallback =
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/unauthorized-domain";

      if (shouldFallback) {
        console.log("[Auth] falling back to redirect…");
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/cancelled-popup-request") {
        // цю помилку якраз спричиняють дубль-виклики; інші — покажемо
        alert(`Не вдалось увійти: ${code || err?.message || err}`);
      }
    } finally {
      signingIn = false;
    }
  },

  async signOut() { /* як було */ },
  async idToken() { /* як було */ },
  onChange(cb) { /* як було */ },
};

  async signOut() {
    console.log("[Auth] signOut()");
    await fbSignOut(auth);
  },

  async idToken() {
    return auth.currentUser ? getIdToken(auth.currentUser, true) : "";
  },

  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      if (u) {
        console.log("[Auth] onChange: user =", u.email);
      } else {
        console.log("[Auth] onChange: user = null");
      }
      cb(this.user);
    });
  },
};

// Після повернення з redirect (виклик безпечний завжди)
getRedirectResult(auth)
  .then((cred) => {
    if (cred) {
      console.log("[Auth] redirect success:", cred?.user?.email);
    } else {
      console.log("[Auth] no redirect result");
    }
  })
  .catch((err) => {
    logAuthError("redirect", err);
  });

// Підв’яжемо кнопки (якщо є на сторінці)
document.getElementById("loginBtn")?.addEventListener("click", () =>
  Auth.signIn().catch((e) => {
    const code = e?.code || "";
    alert(`Не вдалось увійти: ${code || e?.message || e}`);
  }),
);
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());

// Корисно для дебага з консолі
window.Auth = Auth;
