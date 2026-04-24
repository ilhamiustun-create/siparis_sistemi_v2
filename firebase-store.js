// FIREBASE INTEGRATION STARTER
// ==========================
// Bu dosyayı npm + Vite/Next.js projesiyle kullanin
// ADIMLAR:
// 1. npm install firebase
// 2. Firebase config'inizi asagida set edin
// 3. npm run dev ile caliştirin

import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc, onSnapshot } from "firebase/firestore";

// STEP 1: Firebase config'ini buraya yapistirin (Firebase Console'dan)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE", // Firebase Console'dan copy edin
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Firebase initialize
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// STEP 2: Storage adapter - Firestore ile calisan
const store = {
  async getOrders() {
    try {
      const querySnapshot = await getDocs(collection(db, "orders"));
      return querySnapshot.docs.map(d => d.data());
    } catch (e) {
      console.error("Error fetching orders:", e);
      return [];
    }
  },

  async saveOrders(orders) {
    try {
      for (let order of orders) {
        await setDoc(doc(db, "orders", order.no), order);
      }
    } catch (e) {
      console.error("Error saving orders:", e);
    }
  },

  async deleteOrder(orderNo) {
    try {
      await deleteDoc(doc(db, "orders", orderNo));
    } catch (e) {
      console.error("Error deleting order:", e);
    }
  },

  async getConfig() {
    try {
      const docSnap = await getDocs(collection(db, "config"));
      if (!docSnap.empty) {
        return docSnap.docs[0].data();
      }
    } catch (e) {
      console.error("Error getting config:", e);
    }
    return { pin: "9999" };
  },

  async saveConfig(config) {
    try {
      await setDoc(doc(db, "config", "main"), config);
    } catch (e) {
      console.error("Error saving config:", e);
    }
  },

  async getSession() {
    try {
      const val = localStorage.getItem("session_v5");
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  },

  async saveSession(session) {
    try {
      if (session) {
        localStorage.setItem("session_v5", JSON.stringify(session));
      } else {
        localStorage.removeItem("session_v5");
      }
    } catch (e) {
      console.error("Error saving session:", e);
    }
  }
};

// STEP 3: Real-time listener (opsiyonel - otomatik guncellemeler icin)
export function useOrdersRealtime() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Real-time listener: her degisikligi aninda alir
    const unsubscribe = onSnapshot(
      collection(db, "orders"),
      (snapshot) => {
        const data = snapshot.docs.map(d => d.data());
        setOrders(data);
        setLoading(false);
      },
      (error) => {
        console.error("Snapshot error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { orders, loading };
}

// STEP 4: Bu kodu siparis_sistemi_v2.jsx'in store olanindan degistirin
// Yani store = { ... } kisimini yukaridaki store ile degistiriniz

export default store;

// ====== DEPLOYMENT NOTLARI ======
// 
// VERCEL'E UPLOAD:
// 1. GitHub'da repo olustur
// 2. Asagidaki dosyalari yukle:
//
// package.json:
// {
//   "name": "siparis-sistemi",
//   "type": "module",
//   "scripts": {
//     "dev": "vite",
//     "build": "vite build",
//     "preview": "vite preview"
//   },
//   "dependencies": {
//     "react": "^18.2.0",
//     "react-dom": "^18.2.0",
//     "firebase": "^10.7.0"
//   },
//   "devDependencies": {
//     "@vitejs/plugin-react": "^4.2.0",
//     "vite": "^5.0.0"
//   }
// }
//
// vite.config.js:
// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'
// export default defineConfig({
//   plugins: [react()],
// })
//
// 3. https://vercel.com'a gidin
// 4. GitHub'dan import et > Deploy
// 5. Otomatik URL alacaksiniz!
//
// ====== FIRESTORE RULES (DEVELOPMENT) ======
//
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /orders/{document=**} {
//       allow read, write: if true;
//     }
//     match /config/{document=**} {
//       allow read: if true;
//       allow write: if false;
//     }
//   }
// }
//
// ====== SECURITY TIP ======
// 
// Uretimdeki rules daha guvenli olmali:
// Firestore > Rules > edit et
// IP veya kullanici dogrulamasi ekle
//
// Ornek:
// match /orders/{document=**} {
//   allow read: if request.auth != null;
//   allow create: if request.auth != null;
//   allow update, delete: if request.auth.uid == resource.data.userId;
// }
