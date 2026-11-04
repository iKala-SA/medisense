import {useEffect,useState} from 'react';
import {api} from '../api';

/* The real groups from 群組管理 (`GET /api/groups`), for every filter or field that used to offer the fixed 科別 list.
   Loaded once per page load and shared; sorted by name. null while loading, [] when the caller may not list groups. */
let cache=null,pending=null;
export function loadOrgGroups(){
  if(cache)return Promise.resolve(cache);
  pending=pending||api.listGroups().then(l=>{cache=(l||[]).map(g=>({id:g.id,name:g.name||g.id})).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));return cache})
    .catch(()=>{pending=null;return []});
  return pending;
}
export function resetOrgGroups(){cache=null;pending=null}
export function useOrgGroups(){
  const [groups,setGroups]=useState(cache);
  useEffect(()=>{let live=true;loadOrgGroups().then(g=>{if(live)setGroups(g)});return ()=>{live=false}},[]);
  return groups;
}
export const groupName=(groups,id)=>(groups||[]).find(g=>g.id===id)?.name||id;
