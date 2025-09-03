// Firebase (Redirect flow) — без popup → нет COOP предупреждений
// docs/firebase.js
// ==== Firebase Auth (CDN ESM) ====
// Подключай так в HTML, ОБЯЗАТЕЛЬНО после config.js:
//
// <script defer src="config.js"></script>
// <script type="module" src="firebase.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ⚠️ твой реальный конфиг из Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.firebasestorage.app",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

// init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();

// persistence (через IIFE, без top-level await для совместимости)
(async () => {
  try { await setPersistence(auth, browserLocalPersistence); }
  catch { /* ignore */ }
})().catch(() => {});

// провайдер Google
const google = new GoogleAuthProvider();

// Глобальный API
const Auth = {
  user: null,

  // popup → fallback в redirect, если popup заблокирован/закрыт
  async signInGoogle() {
    try {
      await signInWithPopup(auth, google);
    } catch (e) {
      if (
        e?.code === "auth/popup-blocked" ||
        e?.code === "auth/popup-closed-by-user" ||
        e?.code === "auth/cancelled-popup-request"
      ) {
        await signInWithRedirect(auth, google);
      } else {
        throw e;
      }
    }
  },

  async signUpEmail(email, pass) {
    return createUserWithEmailAndPassword(auth, email, pass);
  },

  async signInEmail(email, pass) {
    return signInWithEmailAndPassword(auth, email, pass);
  },

  async signOut() {
    await fbSignOut(auth);
  },

  onChanged(cb) {
    document.addEventListener("auth-changed", (e) => cb?.(e.detail));
  },
};

window.Auth = Auth;

// забираем результат после redirect-логина (чтобы очистить pending)
getRedirectResult(auth).catch(() => {});

// единая точка правды о пользователе
onAuthStateChanged(auth, (u) => {
  const user = u
    ? {
        uid: u.uid,
        email: (u.email || "").toLowerCase(), // всегда нижний регистр
        displayName: u.displayName || "",
        photoURL: u.photoURL || "",
      }
    : null;

  Auth.user = user;
  document.dispatchEvent(new CustomEvent("auth-changed", { detail: user }));
  console.log("[auth] state:", user);
});
