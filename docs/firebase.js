// ==== Firebase Auth (CDN ESM) ====
// docs/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut,
    onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ⚠️ Твій конфіг із Firebase console
const firebaseConfig = {
    apiKey: "AIzaSyBknpQ46_NXV0MisgfjZ7Qs-XS9jhn7hws",
    authDomain: "fir-d9f54.firebaseapp.com",
    projectId: "fir-d9f54",
    storageBucket: "fir-d9f54.firebasestorage.app",
    messagingSenderId: "797519127919",
    appId: "1:797519127919:web:016740e5f7f6fe333eb49a",
    measurementId: "G-LHZJH1VPG6"
};

// 1) Ініт
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();
const google = new GoogleAuthProvider();

// 2) Глобальний об’єкт
const Auth = {
    user: null,

    async signInGoogle() { await signInWithPopup(auth, google); },

    async signUpEmail(email, pass) { return createUserWithEmailAndPassword(auth, email, pass); },
    async signInEmail(email, pass) { return signInWithEmailAndPassword(auth, email, pass); },

    async signOut() { await signOut(auth); },

    onChanged(cb) { document.addEventListener('auth-changed', e => cb?.(e.detail)); },
};
window.Auth = Auth;

// 3) Подія стану
onAuthStateChanged(auth, (u)=>{
    Auth.user = u ? {
        uid: u.uid,
        email: u.email || "",
        displayName: u.displayName || "",
        photoURL: u.photoURL || ""
    } : null;

    document.dispatchEvent(new CustomEvent('auth-changed', { detail: Auth.user }));
});