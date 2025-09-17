// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as fbSignOut,
  getIdToken,
  signInWithRedirect,
  getRedirectResult,
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

export const Auth = {
  user: null,

  // ✅ РЕДИРЕКТ-ЛОГІН — без попапів і без COOP-ворнінгів
  async signIn() {
    await signInWithRedirect(auth, provider);
  },

  async signOut() {
    await fbSignOut(auth);
  },

  async idToken() {
    if (!auth.currentUser) return "";
    return await getIdToken(auth.currentUser, /*forceRefresh*/ true);
  },

  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      cb(u || null);
    });
  },
};

// Після повернення з редіректу — підтягнемо результат (ігноруємо, якщо нема)
getRedirectResult(auth).catch(console.error);

// Прив'язка кнопок (якщо є)
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
if (loginBtn) loginBtn.addEventListener("click", () => Auth.signIn().catch(console.error));
if (logoutBtn) logoutBtn.addEventListener("click", () => Auth.signOut().catch(console.error));
