import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {errText,canEditAgent} from '../live/kit';
import {agentToIn} from './stepkit';

export const blankSafe=x=>({...x,kind:x.kind||(x.steps?.length?'flow':'agent'),capabilities:{web_search:false,spaces:[],connectors:[],db_connectors:[],model_pref:'balanced',thinking:'low',...(x.capabilities||{})},steps:x.steps||[],opening_questions:x.opening_questions||[],icon:x.icon||'',original_prompt:x.original_prompt||''});

/* One agent document with autosave (1.2 s after the last edit) and the lists the editors pick from. */
export default function useAgentDoc(id,me,notify,onMissing){
  const [a,setA]=useState(null),[save,setSave]=useState('saved'),[savedAt,setSavedAt]=useState(null),[lib,setLib]=useState({connectors:[],spaces:[],docs:[],features:null});
  const timer=useRef(null),latest=useRef(null),inflight=useRef(Promise.resolve());
  useEffect(()=>{
    api.getAgent(id).then(x=>{const v=blankSafe(x);setA(v);latest.current=v;setSavedAt(x.updated_at)}).catch(e=>{notify(errText(e));onMissing?.()});
    Promise.allSettled([api.listConnectors(),api.listSpaces(),api.listDocs(),api.features(),api.dbCatalog()]).then(([c,s,d,f,b])=>setLib({dbs:b.value||[],connectors:c.value||[],spaces:(s.value||[]).map(x=>({id:x.id,name:x.name})),docs:(d.value||[]).filter(x=>x.status!=='error').map(x=>({id:x.id,name:x.name})),features:f.value||null}));
  },[id]);// eslint-disable-line
  const canEdit=canEditAgent(a,me);
  const flush=useCallback(()=>{
    clearTimeout(timer.current);const cur=latest.current;if(!cur)return Promise.resolve();
    setSave('saving');
    inflight.current=inflight.current.then(()=>api.updateAgent(id,{...agentToIn(cur),kind:cur.kind})).then(()=>{setSave('saved');setSavedAt(new Date().toISOString())}).catch(e=>{setSave('error');notify('儲存失敗：'+errText(e))});
    return inflight.current;
  },[id]);// eslint-disable-line
  const edit=p=>setA(prev=>{const n={...prev,...p};latest.current=n;if(canEdit){setSave('dirty');clearTimeout(timer.current);timer.current=setTimeout(flush,1200)}return n});
  useEffect(()=>()=>{clearTimeout(timer.current)},[]);
  useEffect(()=>{const h=e=>{if(save==='dirty'||save==='saving'){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h)},[save]);
  return {a,setA,edit,save,savedAt,flush,canEdit,lib};
}
