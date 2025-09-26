// firebase.js — Google Sign-In + Storage helper
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut as fbSignOut, getIdToken,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
  authDomain: "fir-d9f54.firebaseapp.com",
  projectId: "fir-d9f54",
  storageBucket: 'fir-d9f54.appspot.com', // ✅ NOT a URL
  messagingSenderId: "797519127919",
  appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
  measurementId: "G-LHZJH1VPG6",
};

console.log("[Auth] init firebase…");
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
// Можна передати HTTPS bucket URL. За потреби — заміни на "gs://fir-d9f54.appspot.com"
const storage = getStorage(app, "https://fir-d9f54.firebasestorage.app");

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
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/unauthorized-domain") {
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/cancelled-popup-request") {
        alert(code || err?.message || "Sign-in failed");
      }
    } finally { signingIn = false; }
  },
  async signOut() { await fbSignOut(auth); },
  async idToken() { return auth.currentUser ? getIdToken(auth.currentUser, true) : ""; },
  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u || null;
      console.log("[Auth] onChange:", this.user?.email || null);
      cb(this.user);
    });
  },
};

getRedirectResult(auth).catch(e => console.warn("redirect:", e?.message || e));

document.getElementById("loginBtn")?.addEventListener("click", () => Auth.signIn());
document.getElementById("logoutBtn")?.addEventListener("click", () => Auth.signOut());

/** Upload helper → Firebase Storage. Повертає public URL. */
export async function uploadFile(file, pathPrefix = "brand_proofs") {
  if (!file) throw new Error("Файл не обрано");
  if (!Auth.user) throw new Error("Спочатку увійдіть у свій акаунт");
  const uid = Auth.user.uid;
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const ts = Date.now();
  const path = `${pathPrefix}/${uid}/${ts}.${ext}`;
  const ref = sRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(ref);
  return { path, url };
}
