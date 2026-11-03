import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,reauthenticateWithPopup,signInWithPopup,signOut as fbSignOut} from 'firebase/auth';

// Mock mode (the default) keeps the prototype self-contained: no Firebase config, no backend.
// Set VITE_MOCK_API=0 together with the VITE_FIREBASE_* values to use the real platform.
export const MOCK=import.meta.env.VITE_MOCK_API!=='0';
// Preview: live pages with in-memory mock data and no sign-in (design review). npm run dev:preview
export const PREVIEW=import.meta.env.VITE_BK_PREVIEW==='1';

const app=(MOCK||PREVIEW)?null:initializeApp({
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
export const signOut=()=>{bq=null;bqSubs.forEach(f=>f());return auth?fbSignOut(auth):Promise.resolve()};
export async function idToken(){
  if(PREVIEW)return 'preview-token'; // preview mode has no sign-in; requests are served by mocks or fail visibly
  const u=auth?.currentUser;
  if(!u)throw new Error('not signed in');
  return u.getIdToken();
}

// BigQuery runs as the signed-in user: a short-lived Google access token (scope bigquery) kept in memory only and sent with
// chat requests in X-BigQuery-Auth. The backend forwards it to the BigQuery API and never stores it (docs/DB-CONNECTORS-DESIGN.md §6).
const BQ_SCOPE='https://www.googleapis.com/auth/bigquery';
let bq=null;const bqSubs=new Set();
export const bigqueryToken=()=>bq&&bq.exp>Date.now()?bq.token:'';
export const onBigQueryChange=f=>{bqSubs.add(f);return()=>bqSubs.delete(f)};
export async function authorizeBigQuery(){
  const u=auth?.currentUser;
  if(!u)throw new Error('not signed in');
  const provider=new GoogleAuthProvider();
  provider.addScope(BQ_SCOPE);
  provider.setCustomParameters({login_hint:u.email||''});
  const cred=GoogleAuthProvider.credentialFromResult(await reauthenticateWithPopup(u,provider)); // same account only
  if(!cred?.accessToken)throw new Error('Google 沒有回傳授權');
  bq={token:cred.accessToken,exp:Date.now()+55*60e3}; // Google access tokens last an hour
  bqSubs.forEach(f=>f());
  setTimeout(()=>bqSubs.forEach(f=>f()),55*60e3+500);
}
