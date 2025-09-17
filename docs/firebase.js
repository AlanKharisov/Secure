import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, getIdToken,
  signOut as fbSignOut, signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

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
provider.setCustomParameters({ prompt: "select_account" });

export const Auth = {
  user: null,
  async signIn() { await signInWithRedirect(auth, provider); },
  async signOut() { await fbSignOut(auth); },
  async idToken() { return auth.currentUser ? getIdToken(auth.currentUser, true) : ""; },
  onChange(cb) { return onAuthStateChanged(auth, (u) => { this.user = u || null; cb(this.user); }); }
};

// ВАЖЛИВО: викликаємо на кожному завантаженні сторінки
getRedirectResult(auth).catch(err => {
  console.warn("getRedirectResult:", err?.code, err?.message);
});

// Кнопки (якщо є)
document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());
