// Firebase (Redirect flow) — без popup → нет COOP предупреждений
// docs/firebase.js
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

// ⚠️ твой реальный конфиг Web-приложения из консоли Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.firebasestorage.app",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();

// 1) сохраняем сессию между перезагрузками/редиректами
await setPersistence(auth, browserLocalPersistence).catch(() => {});

// 2) провайдер Google
const google = new GoogleAuthProvider();

const Auth = {
  user: null,

  // popup → fallback в redirect, если заблокирован/закрыт
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

// 3) забираем результат редиректа (чтобы очистить pending state)
getRedirectResult(auth).catch(() => {});

// 4) единая точка правды о пользователе
onAuthStateChanged(auth, (u) => {
  const user = u
    ? {
        uid: u.uid,
        email: (u.email || "").toLowerCase(),   // нижний регистр для стабильности
        displayName: u.displayName || "",
        photoURL: u.photoURL || "",
      }
    : null;

  Auth.user = user;
  document.dispatchEvent(new CustomEvent("auth-changed", { detail: user }));
  console.log("[auth] state:", user);
});
