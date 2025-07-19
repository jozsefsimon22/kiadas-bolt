
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, initializeAuth, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCLo5suQWhrf3nLjQjKoJdAfbpYbu8iLM8",
  authDomain: "worthwatch-1x4bs.firebaseapp.com",
  projectId: "worthwatch-1x4bs",
  storageBucket: "worthwatch-1x4bs.firebasestorage.app",
  messagingSenderId: "632206557468",
  appId: "1:632206557468:web:7754c3bc47744220003ad9"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

let auth: ReturnType<typeof getAuth>;

// Dynamically add the current domain for client-side development
if (typeof window !== 'undefined') {
  auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
    // Add other auth settings if needed
  });

  // Add the current hostname to authorized domains on the fly for development.
  // In a production environment, you should add your domain to the Firebase Console.
  if (process.env.NODE_ENV === 'development' && auth.config.authDomain) {
    const currentHost = window.location.hostname;
    const existingDomains = auth.config.authDomain.split(',');
    if (!existingDomains.includes(currentHost)) {
        auth.config.authDomain = [...existingDomains, currentHost].join(',');
    }
  }

} else {
  // For server-side rendering
  auth = getAuth(app);
}

export { app, db, auth };
