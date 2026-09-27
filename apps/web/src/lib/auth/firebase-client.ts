import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";

let configuredAuthPromise: Promise<Auth> | null = null;

export function firebaseAuth(): Promise<Auth> {
  configuredAuthPromise ??= configureFirebaseAuth();
  return configuredAuthPromise;
}

export async function signInWithGoogle(): Promise<void> {
  const auth = await firebaseAuth();
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  const auth = await firebaseAuth();
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOutFromFirebase(): Promise<void> {
  await signOut(await firebaseAuth());
}

async function configureFirebaseAuth(): Promise<Auth> {
  const config = {
    apiKey: requiredEnv(
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    ),
    authDomain: requiredEnv(
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    ),
    projectId: requiredEnv(
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    appId: requiredEnv(
      "NEXT_PUBLIC_FIREBASE_APP_ID",
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    ),
  };
  const app = getApps().length === 0 ? initializeApp(config) : getApp();
  const auth = getAuth(app);
  auth.tenantId = requiredEnv(
    "NEXT_PUBLIC_FIREBASE_TENANT_ID",
    process.env.NEXT_PUBLIC_FIREBASE_TENANT_ID,
  );
  await setPersistence(auth, browserLocalPersistence);
  return auth;
}

function requiredEnv(name: string, value: string | undefined): string {
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required for hosted authentication.`);
  }
  return value;
}
