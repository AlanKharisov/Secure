// firebase.js — Google Sign-In (popup + fallback redirect) + Firebase Storage upload
// Працює з кастомним бакетом gs://fir-d9f54.firebasestorage.app

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
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

// ================== Firebase config ==================
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  // можна залишити appspot, але для ясності ставлю твій кастомний бакет
  storageBucket: "fir-d9f54.firebasestorage.app",
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

// якщо колись захочеш повернутись до дефолтного бакета — змінюй лише цей рядок
const BUCKET_URL = "gs://fir-d9f54.firebasestorage.app";
// const BUCKET_URL = undefined; // ← так було б для дефолтного бакета

// ================== Init ==================
console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ВАЖЛИВО: ініціалізуємо Storage НА КОНКРЕТНИЙ бакет
const storage = BUCKET_URL ? getStorage(app, BUCKET_URL) : getStorage(app);

// ================== Auth ==================
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let signingIn = false;

export const Auth = {
  user: null,

  async signIn() {
    if (signingIn) return;
    signingIn = true;
    console.log("[Auth] signIn() popup…");
    try {
      await signInWithPopup(auth, provider);
      console.log("[Auth] popup success");
    } catch (err) {
      const code = err?.code || "";
      console.warn("[Auth] popup error:", code, err?.message || err);
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/unauthorized-domain"
      ) {
        console.log("[Auth] fallback → redirect");
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/cancelled-popup-request") {
        alert(`Не вдалось увійти: ${code || err?.message || err}`);
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

// Після можливого редіректу (щоб не ламати флоу)
getRedirectResult(auth).catch((err) => {
  if (err) console.warn("[Auth] redirect result:", err.message || err);
});

// Кнопки на сторінці
document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());

// ================== Storage helpers ==================

/**
 * Завантажує файл у Firebase Storage до шляху:
 *   <pathPrefix>/<uid>/<timestamp>.<ext>
 * Повертає { path, url } де url — публічний download URL.
 * ВАЖЛИВО: для запису користувач має бути залогінений,
 * і правила Storage мають дозволяти write на цей шлях.
 */
export async function uploadFile(file, pathPrefix = "brand_proofs") {
  if (!file) throw new Error("Файл не обрано");
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("Увійдіть у акаунт перед завантаженням файлу");
  }
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const ts = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;
  const ref = sRef(storage, path);

  await uploadBytes(ref, file, {
    contentType: file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(ref);
  return { path, url };
}

export { auth, storage };
