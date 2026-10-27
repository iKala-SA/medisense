import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from "firebase/auth";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  // `hd` only pre-selects the Workspace domain in the popup; the backend is the real gate.
  const hd = import.meta.env.VITE_ALLOWED_DOMAIN;
  if (hd) provider.setCustomParameters({ hd, prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export const signOut = () => fbSignOut(auth);

export async function idToken(): Promise<string> {
  const u = auth.currentUser;
  if (!u) throw new Error("not signed in");
  return u.getIdToken();
}
