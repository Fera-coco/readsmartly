export default function handler(req, res) {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: "readstreak-52274.firebaseapp.com",
    projectId: "readstreak-52274",
    storageBucket: "readstreak-52274.firebasestorage.app",
    messagingSenderId: "484829120789",
    appId: "1:484829120789:web:8d0f3fc001d3ee9faec11c",
    measurementId: "G-N83TZW2C5N"
  });
}