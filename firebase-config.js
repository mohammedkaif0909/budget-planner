// Import needed Firebase functions
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCnHiMzSYnC7K3hLzjrd0xF7YNTE563MiU",
  authDomain: "budget-login-ccda8.firebaseapp.com",
  projectId: "budget-login-ccda8",
  storageBucket: "budget-login-ccda8.firebasestorage.app",
  messagingSenderId: "72052414222",
  appId: "1:72052414222:web:994c4645d572bcc87d695f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export auth to use in other pages
export const auth = getAuth(app);
export const db = getFirestore(app);