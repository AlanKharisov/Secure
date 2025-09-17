// firebase.js — Google Sign-In через REDIRECT (офіційний спосіб Firebase)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  getIdToken,
  signOut as fbSignOut,
  signInWithRedirect,
  getRedirectResult,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ⚠️ важливо: authDomain мусить відповідати твоєму проекту Firebase
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
const provider = new GoogleAuthProvider();

// Щоб уникнути блокувань у деяких браузерах
provider.setCustomParameters({ prompt: "select_account" });

export const Auth = {
  user: null,

  // Стартує редірект на Google
  async signIn() {
    await signInWithRedirect(auth, provider);
  },

  async signOut() {
    await fbSignOut(auth);
  },

  async idToken() {
    return auth.currentUser ? getIdToken(auth.currentUser, true) : "";
  },

  // Слухач стану (після редіректу user з’явиться тут)
  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      cb(this.user);
    });
  },
};

// ⬇️ Після повернення з Google доробляємо редірект-флоу
// (виклик не шкодить, навіть якщо редіректу не було)
getRedirectResult(auth).catch((err) => {
  // ловимо, але не валимо UI
  console.warn("getRedirectResult error:", err?.message || err);
});

// Прив’язка кнопок, якщо є на сторінці
document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());
