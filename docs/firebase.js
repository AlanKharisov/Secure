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
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app-check.js";

/* === 1) CONFIG (storageBucket — ІД бакета, НЕ URL) === */
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.appspot.com",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);

/* === 2) App Check (reCAPTCHA v3 — невидима) ===
   - Встав свій SITE KEY нижче (з консолі reCAPTCHA v3).
   - Якщо Storage у App Check в режимі Enforce — це ОБОВ’ЯЗКОВО.
*/
const RECAPTCHA_V3_SITE_KEY = "6LcJ2dUrAAAAAKpA74yjOw0txD1WBTNITp0FFFC7";
if (RECAPTCHA_V3_SITE_KEY && !RECAPTCHA_V3_SITE_KEY.includes("PASTE_")) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} else {
  console.warn("[AppCheck] SITE_KEY не заданий. Якщо Storage=Enforce — додай ключ.");
  // TEMP DEV: у консолі браузера можна виконати:
  // self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  // і додати токен у Firebase Console → App Check → Debug tokens
}

/* === 3) Services === */
const auth = getAuth(app);
const storage = getStorage(app);

/* === 4) Google Sign-In === */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/* === 5) Auth wrapper === */
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
      // fallback на redirect, якщо попап блокується/домен не дозволений
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

  async signOut() {
    await fbSignOut(auth);
  },

  async idToken() {
    return auth.currentUser ? getIdToken(auth.currentUser, true) : "";
  },

  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      console.log("[Auth] onChange:", this.user?.email || null);

      // Клас на body для CSS-правил (опційно)
      document.body.classList.toggle("authed", !!u);

      // Безпечне перемикання кнопок (не залежимо від класу .hidden)
      const loginBtn = document.getElementById("loginBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      if (loginBtn)  loginBtn.style.display  = u ? "none" : "";
      if (logoutBtn) logoutBtn.style.display = u ? "" : "none";

      cb(this.user);
    });
  },
};

// Redirect fallback (якщо попап не спрацював)
getRedirectResult(auth).catch((e) =>
  console.warn("[Auth] redirect:", e?.message || e)
);

// Автопідв’язка кнопок за ID, якщо є у DOM
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
  document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());
});

/* === 6) Storage helpers === */

// Завантажити файл у brand_proofs/<uid>/<timestamp>.<ext> → { path, url }
export async function uploadFile(file, pathPrefix = "brand_proofs") {
  if (!file) throw new Error("Файл не обрано");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");

  const uid = Auth.user.uid;
  const ext = (file.name?.split(".").pop() || "bin").toLowerCase();
  const ts  = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;

  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(fileRef);
  return { path, url };
}

// Завантажити Blob (наприклад, canvas.toBlob(...))
export async function uploadBlob(blob, pathPrefix = "brand_proofs", ext = "png") {
  if (!blob) throw new Error("Порожній blob");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");

  const uid = Auth.user.uid;
  const ts  = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;

  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, blob, {
    contentType: blob.type || `image/${ext}`,
  });
  const url = await getDownloadURL(fileRef);
  return { path, url };
}

// Отримати публічний URL за шляхом у бакеті
export async function getPublicURL(path) {
  const fileRef = sRef(storage, path);
  return await getDownloadURL(fileRef);
}

// Видалити файл за шляхом
export async function deleteFile(path) {
  const fileRef = sRef(storage, path);
  await deleteObject(fileRef);
}

// Зручний хелпер: гарантувати вхід перед дією
export async function ensureLoggedIn() {
  if (!Auth.user) {
    await Auth.signIn();
  }
}
