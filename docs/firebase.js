// docs/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, signInWithPopup, signInWithRedirect, GoogleAuthProvider,
  onAuthStateChanged, signOut as _signOut, getIdToken
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ↓↓↓ ваш реальний конфіг
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.firebasestorage.app",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
// за бажанням: локаль браузера
// auth.useDeviceLanguage();

async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // Будь-які блокування попапів / COOP → редірект
    console.warn("Popup sign-in failed, falling back to redirect:", err);
    await signInWithRedirect(auth, provider);
  }
}

async function signOut() {
  await _signOut(auth);
}

async function idToken() {
  if (!auth.currentUser) return "";
  return await getIdToken(auth.currentUser, true);
}

function onChange(cb) {
  return onAuthStateChanged(auth, (u) => {
    Auth.user = u || null;
    cb(u || null);
  });
}

export const Auth = { user: null, signInWithGoogle, signOut, idToken, onChange };

// Прив’яжемо кнопки якщо вони є на сторінці
const loginBtn  = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
if (loginBtn)  loginBtn.addEventListener("click", () => Auth.signInWithGoogle().catch(console.error));
if (logoutBtn) logoutBtn.addEventListener("click", () => Auth.signOut().catch(console.error));
