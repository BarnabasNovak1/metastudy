import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
}
const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Enable persistent auth state for faster sign-ins
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Auth persistence failed:', err);
});

// Offline persistence: cached docs are served from IndexedDB and do NOT count toward Firestore read quota.
// Uses the new persistentLocalCache API (stable replacement for the old enableIndexedDbPersistence).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const functions = getFunctions(app, 'us-central1')
// Ensure correct storage bucket: prefer env; else fallback to <projectId>.firebasestorage.app
const resolvedBucket = firebaseConfig.storageBucket
  ? firebaseConfig.storageBucket
  : `${firebaseConfig.projectId}.firebasestorage.app`;
export const storage = getStorage(app, `gs://${resolvedBucket}`)



