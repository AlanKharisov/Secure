// /firebase.js — повний файл (CDN v10) без App Check
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

// ---------------- Firebase config ----------------
const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: "fir-d9f54.appspot.com", // важливо: ІД бакета, не URL
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);

// ---------------- Services ----------------
const auth = getAuth(app);
const storage = getStorage(app);

// ---------------- Google provider ----------------
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// ---------------- Auth wrapper ----------------
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

      // Тумблер стану для UI
      document.body.classList.toggle("authed", !!u);

      // Безпечне перемикання кнопок (навіть якщо у них є клас .hidden)
      const loginBtn = document.getElementById("loginBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      if (loginBtn) loginBtn.style.display = u ? "none" : "";
      if (logoutBtn) logoutBtn.style.display = u ? "" : "none";

      cb(this.user);
    });
  },
};

// Redirect fallback (якщо попап заблоковано)
getRedirectResult(auth).catch((e) =>
  console.warn("[Auth] redirect:", e?.message || e)
);

// Автопідв’язка кнопок (якщо є у DOM)
document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  loginBtn?.addEventListener("click", () => Auth.signIn());
  logoutBtn?.addEventListener("click", () => Auth.signOut());
});

// ---------------- Storage helpers ----------------

/**
 * Завантаження файлу у brand_proofs/<uid>/<ts>.<ext>
 * Повертає { path, url }
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

export async function getPublicURL(path) {
  const fileRef = sRef(storage, path);
  return await getDownloadURL(fileRef);
}

export async function deleteFile(path) {
  const fileRef = sRef(storage, path);
  await deleteObject(fileRef);
}

export async function ensureLoggedIn() {
  if (!Auth.user) {
    await Auth.signIn();
  }
}
