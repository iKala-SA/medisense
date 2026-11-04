import {useEffect,useState} from 'react';
import {ArrowRight,GoogleLogo,WindowsLogo,IdentificationCard,LinkSimple} from '@phosphor-icons/react';
import {api} from './api';
import {linkPendingWithGoogle,pendingSsoLink,signInWithGoogle,signInWithSSO} from './firebase';

/* Login buttons for the real platform, from GET /api/auth/providers (登入與 SSO). Only Google on (the default, or the
   providers list unreachable): the single 登入 button as before. Entra ID / LDAP on: one button per method.
   An e-mail that already signs in with Google gets a "用 Google 登入並連結" button so both methods reach the same account. */
export function SignInButtons({onError}){
  const [p,setP]=useState(null),[busy,setBusy]=useState(''),[link,setLink]=useState(false);
  useEffect(()=>{let live=true;api.authProviders().then(v=>live&&setP(v));return()=>{live=false}},[]);
  const go=async(key,fn)=>{
    onError('');setBusy(key);
    try{await fn();setLink(false)}
    catch(e){if(e?.code==='link-required')setLink(!!pendingSsoLink());if(e?.code!=='auth/popup-closed-by-user'&&e?.code!=='auth/cancelled-popup-request')onError(e.message)}
    finally{setBusy('')}
  };
  const google=()=>go('google',()=>signInWithGoogle(p?.google?.hd));
  if(link)return <div className="lg-methods">
    <button type="button" className="btn primary" disabled={!!busy} onClick={()=>go('link',linkPendingWithGoogle)}><LinkSimple/>用 Google 登入並連結</button>
    <button type="button" className="lg-text-btn" onClick={()=>{setLink(false);onError('')}}>改用其他方式</button>
  </div>;
  const sso=[p?.entra?.enabled&&{key:'entra',label:`使用 ${p.entra.label||'Microsoft'} 帳號登入`,icon:<WindowsLogo/>,run:()=>signInWithSSO(p.entra.provider_id,p.entra.hint)},
    p?.ldap?.enabled&&{key:'ldap',label:`使用${p.ldap.label||'院內帳號'}登入`,icon:<IdentificationCard/>,run:()=>signInWithSSO(p.ldap.provider_id,p.ldap.hint)}].filter(Boolean);
  const googleOn=p?.google?.enabled!==false;
  if(!sso.length)return <button type="button" className="btn primary" disabled={!!busy} onClick={google}>登入<ArrowRight/></button>;
  return <div className="lg-methods">
    {googleOn&&<button type="button" className="btn lg-method" disabled={!!busy} onClick={google}><GoogleLogo/>使用 Google Workspace 登入</button>}
    {sso.map(m=><button key={m.key} type="button" className="btn lg-method" disabled={!!busy} onClick={()=>go(m.key,m.run)}>{m.icon}{m.label}</button>)}
  </div>;
}
