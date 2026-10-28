// Helpers for the live chat: model labels from the real LiteLLM groups, step labels, scope mapping.
export const GROUP_LABEL={fast:'快速',reasoning:'深度推理',budget:'低成本',sovereign:'院內模型'};
const BRAND=[[/gemini/i,'Google'],[/claude/i,'Anthropic'],[/gpt-oss|gemma|llama|qwen/i,'院內 / 開放權重'],[/gpt|o\d/i,'OpenAI'],[/nova/i,'Amazon']];
export const providerOf=m=>(BRAND.find(([re])=>re.test(m||''))||[0,''])[1];

/* 'gemini-3.1-pro-preview' -> 'Gemini 3.1 Pro' */
export function modelLabel(id){
  if(!id)return '';
  const s=String(id).replace(/^.*\//,'').replace(/-preview.*$|-\d{8}$|@.*$/,'');
  return s.split('-').map(p=>/^\d/.test(p)?p:p.charAt(0).toUpperCase()+p.slice(1)).join(' ').replace(/(\d) (\d)/g,'$1.$2').replace(/^Gpt/,'GPT').replace(/Gpt /,'GPT ');
}

/* /api/models -> composer options. Every model the proxy really serves is listed and pinned by its own id, so the
   model picked here is the model that answers. The sovereign group is kept as 院內模型 once on-prem is connected. */
export function buildOptions(groups,models){
  const opts=[{id:'auto',name:'Auto · 智慧路由',provider:'自動選擇',desc:'依任務內容套用管理員的路由規則'}];
  const tier=Object.fromEntries((groups||[]).flatMap(g=>(g.models||[]).map(m=>[m.replace(/^.*\//,''),GROUP_LABEL[g.id]||g.id])));
  for(const m of models||[]){
    const raw=m.model.replace(/^.*\//,'');
    opts.push({id:m.id,pin:true,name:modelLabel(raw),provider:providerOf(raw),desc:tier[raw]||'指定模型'});
  }
  for(const g of groups||[])if(g.id==='sovereign')opts.push({id:'sovereign',name:GROUP_LABEL.sovereign,provider:'院內',desc:'資料不出院',disabled:!g.configured,note:g.configured?'':'尚未連接'});
  if(!(models||[]).length)for(const g of groups||[])if(g.id!=='sovereign'&&g.configured)opts.push({id:g.id,name:g.models?.[0]?modelLabel(g.models[0]):GROUP_LABEL[g.id]||g.id,provider:g.models?.[0]?providerOf(g.models[0]):'',desc:GROUP_LABEL[g.id]||g.id});
  return opts;
}
export const toScope=k=>k==='一般知識'?'general':k==='具體資料'?'selected':'all';

export const STEP={input:'收到問題',turn:'思考',knowledge:'檢索院內文件',web_search:'網路搜尋',llm:'撰寫回答',structured_output:'結構化輸出',tool:'連接器動作',approval:'人工核准',his_emr:'HIS/EMR'};
export const stepLabel=t=>STEP[t]||t;
export const seconds=ms=>ms>=1000?(ms/1000).toFixed(1)+' 秒':ms+' 毫秒';

/* Entry for one answered turn (live API or a reopened session). */
export function toEntry(text,reply,{trace=[],citations=[],ms=0,agent,msgIndex,fb}={}){
  const llm=[...trace].reverse().find(s=>s.model);
  return {text,ans:reply,trace,citations,ms,agent,msgIndex,fb,
    used:llm?`${modelLabel(llm.model)}${GROUP_LABEL[llm.group]?' · '+GROUP_LABEL[llm.group]:''}`:'—',
    thinking:trace.map(s=>s.thinking).filter(Boolean)};
}


/* Live run state, fed by the /api/chat/stream events. The MODEL chooses the steps, so the list grows as it works:
   steps: [{node_id,type,status:'running'|'done',reason?,...StepTrace}] */
export const initRun=model=>({steps:[],draft:'',thought:'',citations:[],model,t0:Date.now()});
const upsert=(list,id,patch)=>list.some(s=>s.node_id===id)?list.map(s=>s.node_id===id?{...s,...patch}:s):[...list,{node_id:id,...patch}];
export function reduceRun(r,ev){
  switch(ev.event){
    case 'step_start':return {...r,steps:upsert(r.steps,ev.node_id,{type:ev.type,status:'running'}),...(ev.type==='turn'?{draft:'',thought:''}:{})};
    case 'delta':return ev.kind==='thought'?{...r,thought:r.thought+ev.text}:{...r,draft:r.draft+ev.text};
    case 'step_skip':return {...r,steps:r.steps.filter(s=>s.node_id!==ev.node_id),draft:'',thought:''};  // a turn that ended in tool calls was a decision, not the answer
    case 'citations':return {...r,citations:ev.citations};
    case 'step_done':return {...r,steps:upsert(r.steps,ev.step.node_id,{...ev.step,status:'done'})};
    default:return r;
  }
}

/* Where a passage sits in a document's text: whitespace-insensitive match of the passage start. -> [from,to) or null */
export function locate(text,passage){
  const need=String(passage||'').replace(/\s+/g,'');
  if(need.length<12)return null;
  const map=[];let flat='';
  for(let i=0;i<text.length;i++)if(!/\s/.test(text[i])){flat+=text[i];map.push(i)}
  const at=flat.indexOf(need.slice(0,60));
  if(at<0)return null;
  const last=Math.min(at+need.length,flat.length)-1;
  return [map[at],map[last]+1];
}
