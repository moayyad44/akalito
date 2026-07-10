// ══════════════════════════════════════════════════════════
// firebase-init.js — إعدادات Firebase المشتركة لكل صفحات لوحة الأدمن
// أي صفحة أدمن جديدة تستورد من هذا الملف بدل ما تكرر الإعدادات
// ══════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, initializeFirestore, collection, getDocs, getDoc, query,
  orderBy, limit, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, writeBatch,
  doc, serverTimestamp, getDocFromServer, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAefkYqFsvL9wQEZYnGkb_y47eYZacrs7U",
  authDomain: "akleto-prod.firebaseapp.com",
  projectId: "akleto-prod",
  storageBucket: "akleto-prod.firebasestorage.app",
  messagingSenderId: "739001380275",
  appId: "1:739001380275:web:41da29d05a75481df9efc6"
};

export const app     = initializeApp(firebaseConfig);
export const db      = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const auth    = getAuth(app);
export const storage = getStorage(app);

export {
  collection, getDocs, getDoc, query, orderBy, limit, where, onSnapshot,
  addDoc, setDoc, updateDoc, deleteDoc, writeBatch, doc, serverTimestamp, getDocFromServer,
  runTransaction,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  storageRef, uploadBytes, getDownloadURL
};

/* رفع صورة إلى Firebase Storage وإرجاع الرابط — مشتركة بكل الصفحات */
export async function uploadImage(file, folder) {
  if (!file) return '';
  const safeName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
  const path = `${folder}/${safeName}`;
  const sref = storageRef(storage, path);
  await withTimeout(uploadBytes(sref, file), 15000, 'انتهت مهلة رفع الصورة');
  return await withTimeout(getDownloadURL(sref), 15000, 'انتهت مهلة رفع الصورة');
}

/* يمنع أي عملية من التعليق للأبد */
export function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(message), { code: 'timeout' })), ms))
  ]);
}

/* حارس الدخول — يتحقق من تسجيل الدخول، وإلا يرجّع لصفحة الدخول */
export function requireAuth(onReady) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'akleto-admin.html';
    } else {
      onReady(user);
    }
  });
}

// ══════════════════════════════════════════════════════════
// نظام "أنواع القياس" — مشترك بين شاشة المكونات، شاشة الوجبات، وتطبيق الزبون
// كل مكوّن إله "نوع قياس" (وزن/حجم/عدد)، ومقاديره بالوصفة تُدخل بوحدات مطبخية
// طبيعية (رشة، معلقة كبيرة، كأس صغير...) بدل ما ندخلها بالغرام/المل مباشرة.
// كل وحدة إلها عامل تحويل تقريبي لوحدة الأساس (غرام للوزن، مل للحجم، حبة للعدد).
// ══════════════════════════════════════════════════════════
export const MEASURE_TYPES = {
  weight: {
    label: 'وزن',
    baseUnitLabel: 'غرام',
    recipeUnits: {
      'رشة':         1,
      'معلقة صغيرة':  5,
      'معلقة كبيرة': 15,
      'غرام':         1,
      'كيلو':      1000,
    }
  },
  volume: {
    label: 'حجم',
    baseUnitLabel: 'مل',
    recipeUnits: {
      'معلقة صغيرة':  5,
      'معلقة كبيرة': 15,
      'مل':           1,
      'لتر':       1000,
      'كأس صغير':   200,
      'كأس كبير':   350,
    }
  },
  count: {
    label: 'عدد',
    baseUnitLabel: 'حبة',
    recipeUnits: {
      'حبة': 1,
    }
  }
};

/* يحوّل كمية مُدخلة بوحدة وصفة (متل "2 معلقة كبيرة") لكمية بوحدة الأساس (غرام/مل/حبة) */
export function convertToBase(measureType, recipeUnit, qty) {
  const mt = MEASURE_TYPES[measureType];
  if (!mt) return qty;
  const factor = mt.recipeUnits[recipeUnit];
  return qty * (factor != null ? factor : 1);
}
