import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth,MOCK,PREVIEW} from './firebase';
import {api} from './api';

// Real mode only: follows Firebase sign-in state and loads the platform account (/api/me).
// `me.role` is the single source of truth for permissions: admin | builder | user.
export function useAuth({onSignedIn,onSignedOut}){
  const [me,setMe]=useState(null),[authError,setAuthError]=useState(''),[checking,setChecking]=useState(!MOCK&&!PREVIEW);
  useEffect(()=>{
    if(PREVIEW){const m={uid:'u-lin',email:'chlin@vghtc.gov.tw',name:'Paggie',role:'admin',department:'資訊室'};setMe(m);setChecking(false);onSignedIn?.(m);return}
    if(MOCK)return;
    return onAuthStateChanged(auth,async u=>{
      if(!u){setMe(null);setChecking(false);onSignedOut?.();return}
      try{const m=await api.me();setMe(m);setAuthError('');onSignedIn?.(m)}
      catch(e){setMe(null);setAuthError(e.message.includes('403')?'此帳號無法使用（可能已停用或不在允許的網域）。':e.message);onSignedOut?.()}
      finally{setChecking(false)}
    });
  },[]);
  return {me,authError,checking,setAuthError};
}
