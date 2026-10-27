import {idToken} from './firebase';

// Same-origin in production (Firebase Hosting rewrites /api/** to Cloud Run); Vite proxies it in dev.
async function call(path,init={},json=true){
  const headers={Authorization:`Bearer ${await idToken()}`,...(init.headers||{})};
  if(json)headers['Content-Type']='application/json';
  const res=await fetch(path,{...init,headers});
  if(!res.ok){
    let detail=await res.text();
    try{detail=JSON.parse(detail).detail??detail}catch{/* plain text */}
    throw new Error(`${res.status} ${typeof detail==='string'?detail:JSON.stringify(detail)}`);
  }
  return res.status===204?undefined:res.json();
}
// CSV downloads need the bearer token, so they are fetched as a Blob and saved client-side.
async function blob(path){
  const res=await fetch(path,{headers:{Authorization:`Bearer ${await idToken()}`}});
  if(!res.ok)throw new Error(`${res.status} ${await res.text()}`);
  return res.blob();
}
const body=v=>JSON.stringify(v);
const query=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!==''&&v!=null)).toString();
export function saveBlob(b,filename){
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

export const api={
  health:()=>fetch('/api/health').then(r=>r.json()),
  me:()=>call('/api/me'),
  modelGroups:()=>call('/api/models'),
  // agents
  stats:()=>call('/api/agents/stats'),
  listAgents:()=>call('/api/agents'),
  getAgent:id=>call(`/api/agents/${id}`),
  createAgent:a=>call('/api/agents',{method:'POST',body:body(a)}),
  updateAgent:(id,a)=>call(`/api/agents/${id}`,{method:'PUT',body:body(a)}),
  validate:flow=>call('/api/agents/validate',{method:'POST',body:body(flow)}),
  publishAgent:id=>call(`/api/agents/${id}/publish`,{method:'POST'}),
  requestPublish:id=>call(`/api/agents/${id}/publish-request`,{method:'POST'}),
  withdrawPublish:id=>call(`/api/agents/${id}/publish-request/withdraw`,{method:'POST'}),
  reviewAgent:(id,approve,reason='')=>call(`/api/agents/${id}/review`,{method:'POST',body:body({approve,reason})}),
  reviewQueue:()=>call('/api/agents/reviews'),
  sandboxActivity:()=>call('/api/agents/activity'),
  unpublishAgent:id=>call(`/api/agents/${id}/unpublish`,{method:'POST'}),
  deleteAgent:id=>call(`/api/agents/${id}`,{method:'DELETE'}),
  run:(id,message,session_id,use_published=false,version)=>call(`/api/agents/${id}/run`,{method:'POST',body:body({message,session_id,use_published,version})}),
  approve:(id,session_id,approve)=>call(`/api/agents/${id}/approve`,{method:'POST',body:body({session_id,approve})}),
  // knowledge
  listDocs:()=>call('/api/knowledge'),
  uploadDoc:(file,category,department)=>{const fd=new FormData();fd.append('file',file);fd.append('category',category);fd.append('department',department);return call('/api/knowledge',{method:'POST',body:fd},false)},
  replaceDoc:(id,file)=>{const fd=new FormData();fd.append('file',file);return call(`/api/knowledge/${id}/version`,{method:'POST',body:fd},false)},
  updateDoc:(id,category,department)=>call(`/api/knowledge/${id}`,{method:'PATCH',body:body({category,department})}),
  reindexDoc:id=>call(`/api/knowledge/${id}/reindex`,{method:'POST'}),
  deleteDoc:id=>call(`/api/knowledge/${id}`,{method:'DELETE'}),
  previewDoc:async id=>{const res=await fetch(`/api/knowledge/${id}/preview`,{headers:{Authorization:`Bearer ${await idToken()}`}});if(!res.ok)throw new Error(`${res.status} ${await res.text()}`);return res.text()},
  // audit (admin)
  audit:(q,cursor,limit=25)=>call(`/api/audit?${query({...q,limit,cursor})}`),
  auditSummary:()=>call('/api/audit/summary'),
  auditCsv:q=>blob(`/api/audit/export.csv?${query(q)}`),
  // connectors
  connectorTypes:()=>call('/api/connectors/types'),
  connectorStats:()=>call('/api/connectors/stats'),
  listConnectors:()=>call('/api/connectors'),
  getConnector:id=>call(`/api/connectors/${id}`),
  createConnector:c=>call('/api/connectors',{method:'POST',body:body(c)}),
  updateConnector:(id,c)=>call(`/api/connectors/${id}`,{method:'PUT',body:body(c)}),
  testConnector:id=>call(`/api/connectors/${id}/test`,{method:'POST'}),
  connectorActions:id=>call(`/api/connectors/${id}/actions`),
  deleteConnector:id=>call(`/api/connectors/${id}`,{method:'DELETE'}),
  // monitoring (admin)
  monitoringSummary:q=>call(`/api/monitoring/summary?${query(q)}`),
  monitoringAgents:(q,sort)=>call(`/api/monitoring/agents?${query({...q,sort})}`),
  monitoringCsv:q=>blob(`/api/monitoring/export.csv?${query(q)}`),
  // users (admin)
  listUsers:()=>call('/api/users'),
  getUser:email=>call(`/api/users/${encodeURIComponent(email)}`),
  preregisterUser:(email,role,department)=>call('/api/users',{method:'POST',body:body({email,role,department})}),
  updateUser:(email,patch)=>call(`/api/users/${encodeURIComponent(email)}`,{method:'PATCH',body:body(patch)}),
  cancelPreregistration:email=>call(`/api/users/${encodeURIComponent(email)}`,{method:'DELETE'}),
  usersCsv:()=>blob('/api/users/export.csv')
};
