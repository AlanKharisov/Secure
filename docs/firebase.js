// firebase.js — Google Sign-In + Firebase Storage (CDN v10)
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

/** 1) Конфіг — ВАЖЛИВО: storageBucket = ІДЕНТИФІКАТОР бакета, а не URL */
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.appspot.com", // ✅ правильно
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);

/** 2) Сервіси */
const auth = getAuth(app);
// ✅ НЕ передаємо кастомний URL/gs:// — беремо дефолт з storageBucket
const storage = getStorage(app);

/** 3) Провайдер Google */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/** 4) Простий об’єкт-обгортка для auth */
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
      // fallback на redirect у випадках блокування попапів або домену
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

  /** Отримати свіжий ID токен (для ваших бекенд-запитів) */
  async idToken() {
    return auth.currentUser ? getIdToken(auth.currentUser, true) : "";
  },

  /** Підписка на зміни користувача */
  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      console.log("[Auth] onChange:", this.user?.email || null);
      cb(this.user);
    });
  },
};

// Обробка редіректу після signInWithRedirect (без падіння)
getRedirectResult(auth).catch((e) =>
  console.warn("[Auth] redirect:", e?.message || e)
);

// Кнопки (не обов’язково — тільки якщо вони є на сторінці)
document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());

/** 5) Хелпери для роботи зі Storage */

/**
 * Завантажити файл у Firebase Storage в папку:
 *   {pathPrefix}/{uid}/{timestamp}.{ext}
 * Повертає { path, url } де url — готовий до <img src="...">
 */
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

/**
 * Те саме, але для Blob/Canvas toBlob (коли немає імені файлу)
 */
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

/** Видалити файл за шляхом (для адмінки/редагування) */
export async function deleteFile(path) {
  const fileRef = sRef(storage, path);
  await deleteObject(fileRef);
}

/** Корисно: гарантувати логін перед дією */
export async function ensureLoggedIn() {
  if (!Auth.user) {
    await Auth.signIn();
    // після redirect — цей код просто не виконається;
    // після popup — буде продовження тут
  }
}
