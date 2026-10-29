import {TextT,UploadSimple,Sparkle,Globe,BookOpen,Lightning,MagnifyingGlassPlus,Robot,Image,ChartBar,TreeStructure,Cursor} from '@phosphor-icons/react';

/* Step catalogue (PRD §5). `ready` = runs today (phase 1); the others are listed so the creator sees what is coming. */
export const CATS=[['使用者輸入','input'],['AI 回應','ai'],['資料洞察','data'],['動作','action'],['流程邏輯','logic']];
/* colour of each category's icon tile (colourful on purpose, like the reference: input blue, AI purple-pink, data rose, action orange, logic violet) */
export const TONE={input:['#e4effd','#1f6fe0'],ai:['#f5e9ff','#a11cb8'],data:['#ffe8ef','#d1316b'],action:['#fff0e4','#ef5a1f'],logic:['#efe8ff','#6d3df0'],agent:['#e3f5ea','#239660']};
export const STEP_TYPES={
  text_input:{label:'文字輸入',cat:'input',icon:TextT,ready:true,hint:'執行時向使用者收集一段文字'},
  file_upload:{label:'檔案上傳',cat:'input',icon:UploadSimple,ready:true,hint:'執行時請使用者上傳文件'},
  llm_generate:{label:'一般知識',cat:'ai',icon:Sparkle,ready:true,hint:'直接從基礎 AI 模型取得回應'},
  web_search:{label:'Web 搜尋',cat:'ai',icon:Globe,ready:true,hint:'使用 Web 搜尋取得回應'},
  research:{label:'深度研究',cat:'ai',icon:MagnifyingGlassPlus,ready:false,hint:'長時間的深入研究'},
  agent_call:{label:'呼叫 Agent',cat:'ai',icon:Robot,ready:false,hint:'從自訂 Agent 取得回應'},
  browser_agent:{label:'UI Agent',cat:'ai',icon:Cursor,ready:false,hint:'操作公開網站'},
  image_generate:{label:'產生圖片',cat:'ai',icon:Image,ready:false,hint:'依描述產生圖片'},
  knowledge_query:{label:'內部知識',cat:'ai',icon:BookOpen,ready:true,hint:'查詢院內知識來源並附引用',inMenu:false},
  data_insight:{label:'儀表板／資料主題',cat:'data',icon:ChartBar,ready:false,hint:'向儀表板或資料主題取得洞察',inMenu:false},
  action:{label:'連接器動作',cat:'action',icon:Lightning,ready:true,hint:'對外部系統執行動作（可要求核准）'},
  reasoning_group:{label:'Reasoning Group',cat:'logic',icon:TreeStructure,ready:false,hint:'迴圈、條件、驗證'},
};
export const ON_ERROR=[['stop','停止（預設）'],['retry','重試最多 2 次'],['skip','略過並繼續']];
export const STATUS_LABEL={pending:'等待',running:'執行中',succeeded:'完成',failed:'失敗',skipped:'已略過',waiting_approval:'等待核准',cancelled:'已取消'};

export const uid=()=>Math.random().toString(36).slice(2,8);
export function newStep(type,steps){
  const meta=STEP_TYPES[type],base=meta.label;let n=1,title=base;
  const titles=new Set(steps.map(s=>s.title));while(titles.has(title))title=`${base} ${++n}`;
  const config={text_input:{placeholder:'',default:'',allow_override:true,required:true},file_upload:{required:true},llm_generate:{prompt:'',creativity:0.3,output_pref:'balanced'},
    web_search:{prompt:''},knowledge_query:{prompt:''},action:{connector_id:'',action:'',prompt:'',require_approval:true}}[type]||{};
  return {id:'s'+uid(),type,title,description:'',enabled:true,on_error:'stop',config,children:[]};
}
export const REF=/{{\s*([A-Za-z0-9_-]+)(?:\.([\w.-]+))?\s*}}/g;
export const refsOf=(step)=>{const out=[];const walk=v=>{if(typeof v==='string')for(const m of v.matchAll(REF))out.push(m[1]);else if(v&&typeof v==='object')Object.values(v).forEach(walk)};walk(step.config);return out};

/* The same checks the server makes at publish time (engine/steps.validate_steps), run on every edit. */
export function validate(steps){
  const out=[],add=(level,id,message)=>out.push({level,step_id:id,message});
  const ids=new Set(steps.map(s=>s.id)),before=new Map(),titles=new Map();
  for(const st of steps){
    const t=st.title.trim();
    if(titles.has(t.toLowerCase()))add('error',st.id,`Step 標題「${t}」重複`);titles.set(t.toLowerCase(),1);
    if(!STEP_TYPES[st.type]?.ready)add('error',st.id,`「${STEP_TYPES[st.type]?.label||st.type}」Step 尚未開放`);
    const c=st.config||{};
    const need={llm_generate:['prompt','提示詞'],web_search:['prompt','提示詞'],knowledge_query:['prompt','提示詞']}[st.type];
    if(need&&!String(c[need[0]]||'').trim())add('error',st.id,`「${t}」尚未填寫${need[1]}`);
    if(st.type==='action'){for(const [k,l] of [['connector_id','連接器'],['action','動作'],['prompt','提示詞']])if(!String(c[k]||'').trim())add('error',st.id,`「${t}」尚未填寫${l}`)}
    for(const r of refsOf(st)){
      if(r===st.id||(!before.has(r)&&ids.has(r)))add('error',st.id,`「${t}」引用了後面或自己的 Step`);
      else if(!before.has(r))add('error',st.id,`「${t}」引用了不存在的 Step`);
      else if(!before.get(r))add('warning',st.id,`「${t}」引用了已停用的 Step`);
    }
    before.set(st.id,st.enabled);
  }
  if(steps.length>30)add('warning','',`Step 數量超過 30`);
  return out;
}
export function summary(st,connectors=[]){
  const c=st.config||{};
  if(st.type==='text_input')return c.placeholder||c.default||'向使用者收集文字';
  if(st.type==='file_upload')return '請使用者上傳檔案';
  if(st.type==='action'){const cn=connectors.find(x=>x.id===c.connector_id);return cn?`${cn.name||cn.label} · ${c.action||'未選動作'}`:'尚未選擇連接器'}
  return String(c.prompt||'').replace(REF,m=>'@…').slice(0,80)||'尚未填寫提示詞';
}
export const agentToIn=a=>({name:a.name,description:a.description||'',instructions:a.instructions||'',category:a.category,department:a.department||'',code:a.code||'',
  model_group:a.model_group,temperature:a.temperature,top_p:a.top_p,routing:a.routing,connectors:a.connectors||[],flow:a.flow,test_cases:a.test_cases||[],
  knowledge_doc_ids:a.knowledge_doc_ids||[],icon:a.icon||'',opening_questions:a.opening_questions||[],capabilities:a.capabilities,steps:a.steps||[],original_prompt:a.original_prompt||'',
  ...(a.skill_ids?{skill_ids:a.skill_ids}:{})});
export const blankAgent=()=>({name:'新 Agent',description:'',instructions:'你是院內 AI 助理。請以繁體中文回答，語氣專業簡潔；病人資料已去識別化，不要嘗試還原。',category:'clinical',department:'',code:'',model_group:'auto',temperature:0.3,top_p:0.95,
  routing:{reasoning_keywords:['分析','比較','規劃','為什麼'],sovereign_only:false,max_cost_tier:'reasoning'},connectors:[],flow:{nodes:[],edges:[]},test_cases:[],knowledge_doc_ids:[],icon:'',opening_questions:[],
  capabilities:{web_search:false,spaces:[],connectors:[],model_pref:'balanced',thinking:'low'},steps:[],original_prompt:''});
