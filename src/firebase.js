import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut as fbSignOut} from 'firebase/auth';

// Mock mode (the default) keeps the prototype self-contained: no Firebase config, no backend.
// Set VITE_MOCK_API=0 together with the VITE_FIREBASE_* values to use the real platform.
export const MOCK=import.meta.env.VITE_MOCK_API!=='0';

const app=MOCK?null:initializeApp({
  apiKey:import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:import.meta.env.VITE_FIREBASE_APP_ID
});
export const auth=app?getAuth(app):null;

export function signInWithGoogle(){
  const provider=new GoogleAuthProvider();
  // `hd` only pre-selects the Workspace domain in the popup; the backend is the real gate.
  const hd=import.meta.env.VITE_ALLOWED_DOMAIN;
  if(hd)provider.setCustomParameters({hd,prompt:'select_account'});
  return signInWithPopup(auth,provider);
}
export const signOut=()=>auth?fbSignOut(auth):Promise.resolve();
export async function idToken(){
  const u=auth?.currentUser;
  if(!u)throw new Error('not signed in');
  return u.getIdToken();
}
