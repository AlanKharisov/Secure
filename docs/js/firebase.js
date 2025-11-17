// /firebase.js — Firebase App + App Check (reCAPTCHA v3) + Google Auth + Storage (CDN v10)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut,
  getIdToken,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app-check.js";

/* ===================== 1) CONFIG ===================== */
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  // ВАЖЛИВО: у тебе бакет firebasestorage.app (не appspot.com)
  storageBucket: "fir-d9f54.firebasestorage.app",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);

/* ===== 1.1) FIX для reCAPTCHA loader: polyfill globalThis.process ===== */
if (typeof globalThis.process === "undefined") {
  globalThis.process = { env: {} };
}

/* ===================== 2) APP CHECK (reCAPTCHA v3) ===================== */
/** ВСТАВ свій reCAPTCHA v3 Site Key (НЕ secret). Для Enforce це обовʼязково. */
const RECAPTCHA_V3_SITE_KEY = "6LcJ2dUrAAAAAKpA74yjOw0txD1WBTNITp0FFFC7";

let appCheck = null;
try {
  // Якщо в index.html задано self.FIREBASE_APPCHECK_DEBUG_TOKEN (рядок або true),
  // SDK автоматично увімкне debug-режим. (У проді прибери це.)
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });

  // Діагностика: витягнемо токен і залогаймо префікс
  getAppCheckToken(appCheck, /*forceRefresh*/ true)
    .then(t => {
      if (t?.token) console.log("[AppCheck] token (head):", t.token.slice(0, 18) + "…");
      else console.warn("[AppCheck] no token received");
    })
    .catch(e => console.warn("[AppCheck] getToken error:", e));
} catch (e) {
  console.warn("[AppCheck] init failed:", e);
}

/* ===================== 3) SERVICES ===================== */
const auth = getAuth(app);
// Явно вкажемо правильний бакет (gs://fir-d9f54.firebasestorage.app)
const storage = getStorage(app, "gs://fir-d9f54.firebasestorage.app");

/* ===================== 4) AUTH (Google) ===================== */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let signingIn = false;
export const Auth = {
  user: null,

  async signIn() {
    if (signingIn) return;
    signingIn = true;
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = err?.code || "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/unauthorized-domain"
      ) {
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/cancelled-popup-request") {
        console.error("[Auth] signIn error:", err);
        alert(code || err?.message || "Sign-in failed");
      }
    } finally {
      signingIn = false;
    }
  },

  async signOut() { await fbSignOut(auth); },

  async idToken() { return auth.currentUser ? getIdToken(auth.currentUser, true) : ""; },

  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      console.log("[Auth] onChange:", this.user?.email || null);

      // Перемикаємо кнопки, якщо є
      document.body.classList.toggle("authed", !!u);
      const loginBtn  = document.getElementById("loginBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      if (loginBtn)  loginBtn.style.display  = u ? "none" : "";
      if (logoutBtn) logoutBtn.style.display = u ? "" : "none";

      cb(this.user);
    });
  },
};

getRedirectResult(auth).catch(e => console.warn("[Auth] redirect:", e?.message || e));

/* Автопідʼєднання кнопок, якщо вони є в DOM */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
  document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());
});

/* ===================== 5) STORAGE HELPERS ===================== */

// Завантажити файл у brand_proofs/<uid>/<timestamp>.<ext> → { path, url }
export async function uploadFile(file, pathPrefix = "brand_proofs") {
  if (!file) throw new Error("Файл не обрано");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");

  const uid  = Auth.user.uid;
  const ext  = (file.name?.split(".").pop() || "bin").toLowerCase();
  const ts   = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;

  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(fileRef);
  return { path, url };
}

// Завантажити Blob (наприклад, canvas.toBlob)
export async function uploadBlob(blob, pathPrefix = "brand_proofs", ext = "png") {
  if (!blob) throw new Error("Порожній blob");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");

  const uid  = Auth.user.uid;
  const ts   = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;

  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, blob, { contentType: blob.type || `image/${ext}` });
  const url = await getDownloadURL(fileRef);
  return { path, url };
}

// Отримати публічний URL за шляхом у бакеті
export async function getPublicURL(path) {
  const fileRef = sRef(storage, path);
  return await getDownloadURL(fileRef);
}

// Видалити файл
export async function deleteFile(path) {
  const fileRef = sRef(storage, path);
  await deleteObject(fileRef);
}

// Гарантований логін перед дією
export async function ensureLoggedIn() {
  if (!Auth.user) await Auth.signIn();
}
