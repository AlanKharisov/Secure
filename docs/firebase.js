// firebase.js — повний файл (CDN v10): App, App Check (reCAPTCHA v3), Auth (Google), Storage
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

// -------- (ОПЦІЙНО) App Check: reCAPTCHA v3 (невидима) --------
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app-check.js";

// 1) Конфіг Firebase: ВАЖЛИВО — storageBucket має бути ІД БАКЕТА, не URL
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

// 2) (ОПЦІЙНО) App Check
// - У Firebase Console → Build → App Check → для вашого Web-app зареєструйте reCAPTCHA v3 і візьміть site key.
// - reCAPTCHA v3 НЕ показує віджет; користувач нічого не бачить.
// - Якщо в консолі App Check = Enforce для Storage — цей блок ОБОВ'ЯЗКОВИЙ.
const APP_CHECK_SITE_KEY = "YOUR_RECAPTCHA_V3_SITE_KEY"; // <-- поставте ваш ключ

if (APP_CHECK_SITE_KEY && APP_CHECK_SITE_KEY !== "YOUR_RECAPTCHA_V3_SITE_KEY") {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} else {
  // Якщо у вас Enforce, але ще немає ключа, для локального дебагу можна увімкнути debug token:
  // Відкрийте DevTools → Console і ВРУЧНУ виконайте:
  // self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  // Потім перезавантажте сторінку, заберіть токен із консолі і додайте його в App Check → Debug tokens.
  console.warn("[AppCheck] SITE_KEY не заданий. Якщо Storage в режимі Enforce — увімкніть App Check або додайте debug token.");
}

// 3) Auth (Google)
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// 4) Storage (дефолтний бакет із config)
const storage = getStorage(app);

// 5) Обгортка для Auth
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
      cb(this.user);
    });
  },
};

// Обробка результату редірект-логіну (якщо був fallback)
getRedirectResult(auth).catch((e) =>
  console.warn("[Auth] redirect:", e?.message || e)
);

// (ОПЦІЙНО) Автопідв’язка до кнопок на сторінці, якщо є
document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());

// 6) Хелпери для Storage

/** Завантажити файл у brand_proofs/<uid>/<timestamp>.<ext> і отримати { path, url } */
export async function uploadFile(file, pathPrefix = "brand_proofs") {
  if (!file) throw new Error("Файл не обрано");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");

  const uid = Auth.user.uid;
  const ext = (file.name?.split(".").pop() || "bin").toLowerCase();
  const ts = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;

  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, file, {
    contentType: file.type || "application/octet-stream",
  });

  const url = await getDownloadURL(fileRef);
  return { path, url };
}

/** Завантажити Blob (наприклад, canvas.toBlob) */
export async function uploadBlob(blob, pathPrefix = "brand_proofs", ext = "png") {
  if (!blob) throw new Error("Порожній blob");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");

  const uid = Auth.user.uid;
  const ts = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;

  const fileRef = sRef(storage, path);
  await uploadBytes(fileRef, blob, {
    contentType: blob.type || `image/${ext}`,
  });

  const url = await getDownloadURL(fileRef);
  return { path, url };
}

/** Отримати публічний URL за шляхом у бакеті */
export async function getPublicURL(path) {
  const fileRef = sRef(storage, path);
  return await getDownloadURL(fileRef);
}

/** Видалити файл за шляхом */
export async function deleteFile(path) {
  const fileRef = sRef(storage, path);
  await deleteObject(fileRef);
}

/** Гарантувати логін перед дією (зручно викликати перед аплоадом) */
export async function ensureLoggedIn() {
  if (!Auth.user) {
    await Auth.signIn();
  }
}
