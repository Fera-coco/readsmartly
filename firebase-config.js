import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

  const firebaseConfig = {
    apiKey: "AIzaSyBEqnLqEkbgHHc4pgJQQsMXUCWOxRhSKiQ",
    authDomain: "readstreak-52274.firebaseapp.com",
    projectId: "readstreak-52274",
    storageBucket: "readstreak-52274.firebasestorage.app",
    messagingSenderId: "484829120789",
    appId: "1:484829120789:web:8d0f3fc001d3ee9faec11c",
    measurementId: "G-N83TZW2C5N"
  };

const app = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);