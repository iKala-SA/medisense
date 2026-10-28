import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {PushPin,LockKey,Export,Archive,ArrowCounterClockwise,DotsThree,FolderSimple,FolderSimplePlus,NotePencil,ArrowsDownUp,Layout,Trash,PencilSimple,FolderOpen,FolderSimpleMinus,Check,CaretRight,CaretDown,Plus} from '@phosphor-icons/react';
import {api} from './api';
import {fitMenu} from './fitMenu';
import './recents.css';

/* Sidebar sections modelled on ChatGPT: 專案 (folders of chats) and 最近項目 (the rest), with a section menu (…),
   a time filter (≡), new chat (✎), and a per-row menu (rename / move to project / delete). */
const PREF='medisense.sidebar';
const load=()=>{try{return {projects:true,sort:'updated',order:'projects',open:true,projOpen:true,range:'all',...JSON.parse(localStorage.getItem(PREF)||'{}')}}catch{return {projects:true,sort:'updated',order:'projects',open:true,projOpen:true,range:'all'}}};
const RANGES=[['all','全部對話',0],['day','今天',1],['week','最近 7 天',7],['month','最近 30 天',30]];
const byPin=(a,b)=>(b.pinned?1:0)-(a.pinned?1:0);
export const tOf=(c,k)=>{const v=k==='created'?(c.created_at||c.updated_at):c.updated_at;const t=v?new Date(v).getTime():Date.now();return Number.isNaN(t)?0:t};

function FilterIcon({size=18}){return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3.5 5.5h13M6 10h8M8.5 14.5h3"/></svg>}

function useFit(ref,flip){useLayoutEffect(()=>fitMenu(ref.current,flip))}

/* A floating menu anchored to a button (fixed, so the sidebar's overflow never clips it). */
function Pop({anchor,onClose,children,width=236}){
  const r=anchor.getBoundingClientRect(),room=window.innerHeight-r.bottom;
  const left=Math.min(r.left,window.innerWidth-width-12),style=room<260?{left,bottom:window.innerHeight-r.top+6,width}:{left,top:r.bottom+6,width};
  useEffect(()=>{const k=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  const ref=useRef(null);useFit(ref,false);
  return createPortal(<><div className="rc-dismiss" onClick={onClose}/><div className="rc-menu" ref={ref} style={style} role="menu">{children}</div></>,document.body);
}
const Item=({icon:I,children,onClick,sub,danger,check,disabled,title})=><button type="button" role="menuitem" title={title||(disabled?'對話已鎖定，請先解除鎖定':undefined)} disabled={disabled} className={'rc-item'+(danger?' danger':'')} onClick={onClick}>{I&&<I size={18}/>}<span>{children}</span>{check&&<Check size={16} className="rc-check"/>}{sub&&<CaretRight size={14} className="rc-caret"/>}</button>;
/* a row that opens a flyout to its right on hover/focus */
function Fly({icon,label,children}){
  const [open,setOpen]=useState(false),sub=useRef(null);useFit(sub,true);
  return <div className="rc-fly" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><Item icon={icon} sub onClick={()=>setOpen(o=>!o)}>{label}</Item>{open&&<div className="rc-menu rc-sub" ref={sub} role="menu">{children}</div>}</div>;
}

function Confirm({title,body,action,onCancel,onOk}){
  return createPortal(<div className="rc-modal" onClick={onCancel}><div className="rc-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><h3>{title}</h3><p>{body}</p><div><button type="button" className="ghost" onClick={onCancel}>取消</button><button type="button" className="danger" autoFocus onClick={onOk}>{action}</button></div></div></div>,document.body);
}

function NameInput({value,onDone}){
  const [v,setV]=useState(value);
  return <input className="rc-rename" autoFocus value={v} maxLength={80} onChange={e=>setV(e.target.value)} onFocus={e=>e.target.select()} onBlur={()=>onDone(v)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')onDone(null)}}/>;
}

export function useRecents({MOCK,chats,setChats,projects,setProjects,notify,onDeleted,onProjectDeleted}){
  /* shared actions for the sidebar and the project page */
  const [busy,setBusy]=useState(false);
  const run=async(fn)=>{if(busy)return;setBusy(true);try{await fn()}catch(e){notify?.(e.message)}finally{setBusy(false)}};
  return {
    renameChat:(id,title)=>run(async()=>{title=(title||'').trim();if(!title)return;if(!MOCK)await api.renameSession(id,title);setChats(l=>l.map(c=>c.id===id?{...c,title}:c))}),
    patchChat:(id,patch)=>run(async()=>{if(!MOCK)await api.updateSession(id,patch);setChats(l=>l.map(c=>c.id===id?{...c,...patch}:c))}),
    moveChat:(id,pid)=>run(async()=>{if(!MOCK)await api.moveSession(id,pid||'');setChats(l=>l.map(c=>c.id===id?{...c,project_id:pid||''}:c))}),
    deleteChat:id=>run(async()=>{if(!MOCK)await api.deleteSession(id);setChats(l=>l.filter(c=>c.id!==id));onDeleted?.(id)}),
    createProject:name=>run(async()=>{name=(name||'').trim();if(!name)return;const p=MOCK?{id:'p'+Date.now(),name}:await api.createProject(name);setProjects(l=>[...l,p]);return p}),
    renameProject:(id,name)=>run(async()=>{name=(name||'').trim();if(!name)return;if(!MOCK)await api.renameProject(id,name);setProjects(l=>l.map(p=>p.id===id?{...p,name}:p))}),
    deleteProject:id=>run(async()=>{if(!MOCK)await api.deleteProject(id);setProjects(l=>l.filter(p=>p.id!==id));setChats(l=>l.map(c=>c.project_id===id?{...c,project_id:''}:c));onProjectDeleted?.(id)}),
  };
}

/* the … menu of one chat; `anchor` is the button */
export function ChatMenu({chat,anchor,projects,actions,onClose,onRename,onAsk,onNewProject}){
  const done=fn=>()=>{onClose();fn()},lock=!!chat.locked;
  return <Pop anchor={anchor} onClose={onClose} width={236}>
    <Item icon={PencilSimple} disabled={lock} onClick={done(onRename)}>重新命名</Item>
    <Item icon={PushPin} onClick={done(()=>actions.patchChat(chat.id,{pinned:!chat.pinned}))}>{chat.pinned?'取消釘選':'釘選'}</Item>
    <Item icon={LockKey} onClick={done(()=>actions.patchChat(chat.id,{locked:!chat.locked}))}>{lock?'解除鎖定':'鎖定對話'}</Item>
    <hr/>
    <Item icon={Export} disabled title="對話可能含院內資料，分享功能需先定義權限後才會開放">分享</Item>
    <hr/>
    {chat.archived?<Item icon={ArrowCounterClockwise} disabled={lock} onClick={done(()=>actions.patchChat(chat.id,{archived:false}))}>取消封存</Item>:<Item icon={Archive} disabled={lock} onClick={done(()=>actions.patchChat(chat.id,{archived:true}))}>封存</Item>}
    <Item icon={Trash} danger disabled={lock} onClick={done(()=>onAsk({kind:'chat',chat}))}>刪除</Item>
    <hr/>
    <Fly icon={FolderOpen} label="移至專案">
      {projects.map(p=><Item key={p.id} icon={FolderSimple} check={chat.project_id===p.id} disabled={lock} onClick={done(()=>actions.moveChat(chat.id,p.id))}>{p.name}</Item>)}
      {projects.length>0&&<hr/>}
      <Item icon={FolderSimplePlus} disabled={lock} onClick={done(()=>onNewProject(chat))}>新專案</Item>
      {chat.project_id&&<Item icon={FolderSimpleMinus} disabled={lock} onClick={done(()=>actions.moveChat(chat.id,''))}>移出專案</Item>}
    </Fly>
  </Pop>;
}

export function ChatRow({chat,active,onOpen,projects,actions,onAsk,onNewProject,showProject}){
  const [menu,setMenu]=useState(null),[edit,setEdit]=useState(false),btn=useRef(null);
  const pr=showProject&&projects.find(p=>p.id===chat.project_id);
  return <div className={'rc-row'+(active?' active':'')+(menu?' menu-open':'')}>
    {edit?<NameInput value={chat.title} onDone={v=>{setEdit(false);if(v!=null&&v.trim()&&v.trim()!==chat.title)actions.renameChat(chat.id,v)}}/>
      :<button type="button" className="rc-main" title={chat.title} onClick={()=>onOpen(chat)}><span>{chat.title}</span>{pr&&<small>{pr.name}</small>}{chat.locked&&<LockKey size={13} className="rc-flag"/>}{chat.pinned&&<PushPin size={13} className="rc-flag"/>}</button>}
    {!edit&&<button type="button" ref={btn} className="rc-dots" aria-label={`「${chat.title}」的更多選項`} aria-haspopup="menu" aria-expanded={!!menu} onClick={()=>setMenu(btn.current)}><DotsThree size={20} weight="bold"/></button>}
    {menu&&<ChatMenu chat={chat} anchor={menu} projects={projects} actions={actions} onClose={()=>setMenu(null)} onRename={()=>setEdit(true)} onAsk={onAsk} onNewProject={onNewProject}/>}
  </div>;
}

export function Recents({chats,projects,actions,activeId,activeProject,onOpen,onNewChat,onOpenProject,collapsed}){
  const [pref,setPref]=useState(load),[menu,setMenu]=useState(null),[ask,setAsk]=useState(null),[naming,setNaming]=useState(null),[projEdit,setProjEdit]=useState(null),[projMenu,setProjMenu]=useState(null);
  const dots=useRef(null),filt=useRef(null);
  const set=patch=>setPref(p=>{const n={...p,...patch};try{localStorage.setItem(PREF,JSON.stringify(n))}catch{}return n});
  const days=RANGES.find(r=>r[0]===pref.range)?.[2]||0;
  const list=useMemo(()=>{
    const now=Date.now();
    const arch=pref.range==='archived';
    return chats.filter(c=>!!c.archived===arch).filter(c=>arch||!c.project_id||!pref.projects).filter(c=>!days||now-tOf(c,'updated')<=days*864e5).sort((a,b)=>(arch?0:byPin(a,b))||tOf(b,pref.sort)-tOf(a,pref.sort));
  },[chats,pref.sort,pref.projects,pref.range,days]);
  const newProject=async(chat)=>{const p=await actions.createProject(naming?.name);if(p&&chat?.id)await actions.moveChat(chat.id,p.id);setNaming(null)};
  const projectsBlock=pref.projects&&<div className="rc-sec" key="projects">
    <div className="rc-head"><button type="button" className="rc-title" aria-expanded={pref.projOpen} onClick={()=>set({projOpen:!pref.projOpen})}><span>專案</span>{pref.projOpen?<CaretDown size={13}/>:<CaretRight size={13}/>}</button><button type="button" className="rc-ico" aria-label="新專案" title="新專案" onClick={()=>setNaming({name:''})}><Plus size={16}/></button></div>
    {pref.projOpen&&(projects.length===0?<p className="rc-empty">沒有專案</p>:projects.map(p=><div key={p.id} className={'rc-row proj'+(activeProject===p.id?' active':'')}>
      {projEdit===p.id?<NameInput value={p.name} onDone={v=>{setProjEdit(null);if(v!=null&&v.trim()&&v.trim()!==p.name)actions.renameProject(p.id,v)}}/>
        :<button type="button" className="rc-main" title={p.name} onClick={()=>onOpenProject(p)}><FolderSimple size={18}/><span>{p.name}</span></button>}
      {projEdit!==p.id&&<button type="button" className="rc-dots" aria-label={`專案「${p.name}」的更多選項`} onClick={e=>setProjMenu({p,el:e.currentTarget})}><DotsThree size={20} weight="bold"/></button>}
    </div>))}
  </div>;
  const recentBlock=<div className="rc-sec" key="recent">
    <div className="rc-head"><button type="button" className="rc-title" aria-expanded={pref.open} onClick={()=>set({open:!pref.open})}><span>最近項目</span>{pref.open?<CaretDown size={13}/>:<CaretRight size={13}/>}</button>
      <span className="rc-tools">
        <button type="button" ref={dots} className="rc-ico" aria-label="側邊欄選項" aria-haspopup="menu" onClick={()=>setMenu('main')}><DotsThree size={20} weight="bold"/></button>
        <button type="button" ref={filt} className={'rc-ico'+(pref.range!=='all'?' on':'')} aria-label="篩選對話" aria-haspopup="menu" onClick={()=>setMenu('filter')}><FilterIcon/></button>
        <button type="button" className="rc-ico" aria-label="新對話" title="新對話" onClick={onNewChat}><NotePencil size={18}/></button>
      </span></div>
    {pref.open&&(list.length===0?<p className="rc-empty">{pref.range==='archived'?'沒有已封存的對話':pref.range!=='all'?'這個時間範圍沒有對話':'尚無聊天記錄'}</p>:list.map(c=><ChatRow key={c.id} chat={c} active={c.id===activeId} onOpen={onOpen} projects={projects} actions={actions} onAsk={setAsk} onNewProject={ch=>setNaming({name:'',chat:ch})}/>))}
  </div>;
  return <div className="recents rc">
    {pref.order==='projects'?<>{projectsBlock}{recentBlock}</>:<>{recentBlock}{projectsBlock}</>}
    {menu==='main'&&dots.current&&<Pop anchor={dots.current} onClose={()=>setMenu(null)} width={250}>
      <Fly icon={Layout} label="整理側邊欄"><Item check={pref.order==='projects'} onClick={()=>{set({order:'projects'});setMenu(null)}}>專案在上</Item><Item check={pref.order==='recent'} onClick={()=>{set({order:'recent'});setMenu(null)}}>最近項目在上</Item></Fly>
      <Fly icon={ArrowsDownUp} label="排序對話依據"><Item check={pref.sort==='updated'} onClick={()=>{set({sort:'updated'});setMenu(null)}}>更新時間</Item><Item check={pref.sort==='created'} onClick={()=>{set({sort:'created'});setMenu(null)}}>建立時間</Item></Fly>
      <hr/><p className="rc-cap">顯示</p>
      <Item check={pref.projects} onClick={()=>set({projects:!pref.projects})}>專案</Item>
    </Pop>}
    {menu==='filter'&&filt.current&&<Pop anchor={filt.current} onClose={()=>setMenu(null)} width={190}>
      {RANGES.map(([k,n])=><Item key={k} check={pref.range===k} onClick={()=>{set({range:k});setMenu(null)}}>{n}</Item>)}<hr/><Item icon={Archive} check={pref.range==='archived'} onClick={()=>{set({range:pref.range==='archived'?'all':'archived'});setMenu(null)}}>已封存對話</Item>
    </Pop>}
    {projMenu&&<Pop anchor={projMenu.el} onClose={()=>setProjMenu(null)} width={200}>
      <Item icon={PencilSimple} onClick={()=>{setProjEdit(projMenu.p.id);setProjMenu(null)}}>重新命名</Item><hr/>
      <Item icon={Trash} danger onClick={()=>{setAsk({kind:'project',project:projMenu.p});setProjMenu(null)}}>刪除專案</Item>
    </Pop>}
    {naming&&createPortal(<div className="rc-modal" onClick={()=>setNaming(null)}><form className="rc-dialog" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();newProject(naming.chat)}}><h3>新專案</h3><p>把相關的對話放在一起。</p><input autoFocus maxLength={60} placeholder="專案名稱" value={naming.name} onChange={e=>setNaming({...naming,name:e.target.value})}/><div><button type="button" className="ghost" onClick={()=>setNaming(null)}>取消</button><button type="submit" className="primary" disabled={!naming.name.trim()}>建立專案</button></div></form></div>,document.body)}
    {ask?.kind==='chat'&&<Confirm title="刪除對話？" body={`這會刪除「${ask.chat.title}」，無法復原。`} action="刪除" onCancel={()=>setAsk(null)} onOk={()=>{actions.deleteChat(ask.chat.id);setAsk(null)}}/>}
    {ask?.kind==='project'&&<Confirm title="刪除專案？" body={`「${ask.project.name}」會被刪除，其中的對話會回到最近項目，不會被刪除。`} action="刪除專案" onCancel={()=>setAsk(null)} onOk={()=>{actions.deleteProject(ask.project.id);setAsk(null)}}/>}
  </div>;
}

/* ChatGPT-style project page: the project's name, a button to start a chat inside it, and its conversations. */
export function ProjectPage({project,chats,projects,actions,onOpen,onNewChat,onBack}){
  const [ask,setAsk]=useState(null),[edit,setEdit]=useState(false),[naming,setNaming]=useState(null);
  const mine=chats.filter(c=>c.project_id===project.id&&!c.archived).sort((a,b)=>byPin(a,b)||tOf(b,'updated')-tOf(a,'updated'));
  return <div className="rc-page">
    <div className="rc-page-head">{edit?<NameInput value={project.name} onDone={v=>{setEdit(false);if(v!=null&&v.trim()&&v.trim()!==project.name)actions.renameProject(project.id,v)}}/>:<h1><FolderSimple size={26}/>{project.name}</h1>}
      <span><button type="button" className="rc-ghost" onClick={()=>setEdit(true)}><PencilSimple size={16}/>重新命名</button><button type="button" className="rc-ghost danger" onClick={()=>setAsk('project')}><Trash size={16}/>刪除專案</button></span></div>
    <button type="button" className="rc-start" onClick={()=>onNewChat(project)}><NotePencil size={18}/>在「{project.name}」開始新對話</button>
    <h2>對話</h2>
    {mine.length===0?<p className="rc-empty big">這個專案還沒有對話。開始新對話，或從側邊欄的對話選單選「移至專案」。</p>:<div className="rc-list">{mine.map(c=><ChatRow key={c.id} chat={c} onOpen={onOpen} projects={projects} actions={actions} onAsk={setAsk} onNewProject={ch=>setNaming({chat:ch,name:''})}/>)}</div>}
    {ask==='project'&&<Confirm title="刪除專案？" body={`「${project.name}」會被刪除，其中的對話會回到最近項目，不會被刪除。`} action="刪除專案" onCancel={()=>setAsk(null)} onOk={()=>{setAsk(null);actions.deleteProject(project.id);onBack()}}/>}
    {ask?.kind==='chat'&&<Confirm title="刪除對話？" body={`這會刪除「${ask.chat.title}」，無法復原。`} action="刪除" onCancel={()=>setAsk(null)} onOk={()=>{actions.deleteChat(ask.chat.id);setAsk(null)}}/>}
    {naming&&createPortal(<div className="rc-modal" onClick={()=>setNaming(null)}><form className="rc-dialog" onClick={e=>e.stopPropagation()} onSubmit={async e=>{e.preventDefault();const p=await actions.createProject(naming.name);if(p)await actions.moveChat(naming.chat.id,p.id);setNaming(null)}}><h3>新專案</h3><input autoFocus maxLength={60} placeholder="專案名稱" value={naming.name} onChange={e=>setNaming({...naming,name:e.target.value})}/><div><button type="button" className="ghost" onClick={()=>setNaming(null)}>取消</button><button type="submit" className="primary" disabled={!naming.name.trim()}>建立專案</button></div></form></div>,document.body)}
  </div>;
}
