export const errText=e=>String(e?.message||e).replace(/^Error:\s*/,'');
export const fmtTime=t=>{if(!t)return '—';const d=new Date(typeof t==='object'&&t.seconds?t.seconds*1000:t);return isNaN(d)?'—':d.toLocaleString('zh-TW',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};

export const MODEL_GROUP_IDS=['fast','reasoning','budget','sovereign'];
export const GROUP_HINT={fast:'快速',reasoning:'深度推理',budget:'低成本',sovereign:'院內模型（不回退雲端）'};
const COST_TIER={budget:0,fast:1,reasoning:2};
export const clampToCap=(group,cap)=>group in COST_TIER&&COST_TIER[group]>COST_TIER[cap]?cap:group;

// Mirrors NODE_KINDS in the platform frontend types.ts (icons are Phosphor names, resolved in Canvas.jsx).
export const NODE_KINDS=[
  {type:'his_emr',label:'HIS/EMR 輸入',hint:'院內 FHIR 閘道（尚未串接，stub）'},
  {type:'knowledge',label:'知識檢索 (RAG)',hint:'從此 Agent 的知識庫檢索段落'},
  {type:'llm',label:'醫療大模型',hint:'一次模型推論'},
  {type:'condition',label:'條件判斷',hint:'LLM 回答 YES/NO 決定分支'},
  {type:'structured_output',label:'結構化輸出',hint:'依 JSON Schema 輸出'},
  {type:'tool',label:'連接器動作',hint:'Google Workspace（stub）'},
  {type:'approval',label:'人工核准',hint:'暫停等待負責人核准',retired:true},
  {type:'pii_mask',label:'敏感資安遮蔽（已停用）',hint:'平台已自動去識別化',retired:true},
  {type:'output',label:'回覆',hint:'最終回覆模板'}
];
export const NODE_LABEL=Object.fromEntries([['input','使用者輸入'],...NODE_KINDS.map(k=>[k.type,k.label])]);

export const defaultFlow=()=>({
  nodes:[
    {id:'in',type:'input',position:{x:40,y:160},data:{label:'使用者輸入'}},
    {id:'llm',type:'llm',position:{x:340,y:160},data:{label:'醫療大模型',prompt:'{{input}}'}},
    {id:'out',type:'output',position:{x:640,y:160},data:{label:'回覆',template:'{{last}}'}}
  ],
  edges:[{id:'e-in-llm',source:'in',target:'llm'},{id:'e-llm-out',source:'llm',target:'out'}]
});
export const defaultRouting=()=>({reasoning_keywords:['分析','比較','規劃','為什麼'],sovereign_only:false,max_cost_tier:'reasoning'});

// Full body for PUT: AgentIn replaces the whole document, so share/skill_ids must be echoed back or they are reset.
export const toAgentIn=a=>({
  name:a.name,description:a.description||'',instructions:a.instructions||'',category:a.category||'clinical',department:a.department||'',code:a.code||'',
  model_group:a.model_group,temperature:a.temperature,top_p:a.top_p,routing:a.routing||defaultRouting(),connectors:a.connectors||[],
  flow:a.flow||defaultFlow(),test_cases:a.test_cases||[],knowledge_doc_ids:a.knowledge_doc_ids||[],
  ...(a.skill_ids?{skill_ids:a.skill_ids}:{}),...(a.share?{share:a.share}:{})
});

export const canEditAgent=(a,me)=>!!a&&!!me&&(me.role==='admin'||(a.owner_uid===me.uid&&me.role==='builder'));
export function statusBadges(a){
  const out=[a.status==='published'?'已發布':'草稿'];
  if(a.review?.state==='pending')out.push('待審核');
  else if(a.review?.state==='rejected')out.push('已退回');
  return out;
}

/* the person who created the agent: by user id, or by e-mail (the id can differ between sign-in methods) */
export const isMine=(a,me)=>!!a&&!!me&&(a.owner_uid===me.uid||(!!a.owner_email&&a.owner_email===me.email));
