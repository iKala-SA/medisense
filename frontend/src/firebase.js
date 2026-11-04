import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,OAuthProvider,linkWithCredential,reauthenticateWithPopup,signInWithPopup,signOut as fbSignOut} from 'firebase/auth';

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

export function signInWithGoogle(hdHint){
  const provider=new GoogleAuthProvider();
  // `hd` only pre-selects the Workspace domain in the popup; the backend is the real gate.
  const hd=hdHint||import.meta.env.VITE_ALLOWED_DOMAIN;
  if(hd)provider.setCustomParameters({hd,prompt:'select_account'});
  return signInWithPopup(auth,provider);
}

// Enterprise SSO: Microsoft Entra ID and LDAP sign in through Keycloak, which Identity Platform trusts as one OIDC provider
// (GET /api/auth/providers names it). `hint` = Keycloak's kc_idp_hint ("entra" jumps straight to Microsoft; "" shows the
// Keycloak username / password page that checks the hospital directory).
// Every user's data is keyed by the Firebase uid, so an e-mail that already signs in with Google must LINK the new method
// to that same user: Firebase refuses with account-exists-with-different-credential, we keep the pending credential and
// the login page asks the person to sign in with Google once (a second click: a popup needs a user gesture) to link it.
let pendingLink=null; // {credential, email}
export const pendingSsoLink=()=>pendingLink;
export async function signInWithSSO(providerId,hint){
  const provider=new OAuthProvider(providerId);
  provider.addScope('email');provider.addScope('profile');
  provider.setCustomParameters(hint?{kc_idp_hint:hint}:{});
  try{const r=await signInWithPopup(auth,provider);pendingLink=null;return r}
  catch(e){
    if(e?.code==='auth/account-exists-with-different-credential'){
      const credential=OAuthProvider.credentialFromError(e);
      pendingLink=credential?{credential,email:e.customData?.email||''}:null;
      const err=new Error(pendingLink?`${pendingLink.email||'這個 email'} 已用 Google 登入過。請按「用 Google 登入並連結」，之後兩種方式都能登入同一個帳號。`:'這個 email 已用其他方式登入過，請先用原本的方式登入。');
      err.code='link-required';throw err;
    }
    throw e;
  }
}
export async function linkPendingWithGoogle(){
  if(!pendingLink)throw new Error('沒有待連結的登入方式');
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({login_hint:pendingLink.email,prompt:'select_account'});
  const r=await signInWithPopup(auth,provider);
  await linkWithCredential(r.user,pendingLink.credential); // same uid: sessions, files and connectors stay
  pendingLink=null;
  return r;
}
export const signOut=()=>{bq=null;storeBq(null);bqSubs.forEach(f=>f());return auth?fbSignOut(auth):Promise.resolve()};
export async function idToken(){
  if(PREVIEW)return 'preview-token'; // preview mode has no sign-in; requests are served by mocks or fail visibly
  const u=auth?.currentUser;
  if(!u)throw new Error('not signed in');
  return u.getIdToken();
}

// BigQuery runs as the signed-in user: a short-lived Google access token (scope bigquery) kept in memory only and sent with
// chat requests in X-BigQuery-Auth. The backend forwards it to the BigQuery API and never stores it (docs/DB-CONNECTORS-DESIGN.md §6).
const BQ_SCOPE='https://www.googleapis.com/auth/bigquery';
// The token survives a reload within this tab (sessionStorage: gone when the tab closes, never shared across tabs or sites),
// so a page refresh inside the hour does not ask for authorization again.
const BQ_KEY='ms.bq';
const loadBq=()=>{try{const v=JSON.parse(sessionStorage.getItem(BQ_KEY)||'null');return v&&v.exp>Date.now()?v:null}catch{return null}};
const storeBq=v=>{try{v?sessionStorage.setItem(BQ_KEY,JSON.stringify(v)):sessionStorage.removeItem(BQ_KEY)}catch{/* private mode */}};
let bq=loadBq();const bqSubs=new Set();
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
  storeBq(bq);
  bqSubs.forEach(f=>f());
  setTimeout(()=>bqSubs.forEach(f=>f()),55*60e3+500);
}
