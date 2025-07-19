
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, initializeAuth, browserLocalPersistence } from "firebase/auth";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: projectId,
  storageBucket: `${projectId}.appspot.com`,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
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
