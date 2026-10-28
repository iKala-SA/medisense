import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjk from 'remark-cjk-friendly';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import java from 'highlight.js/lib/languages/java';
import {Code,FileText,Copy,Check,DownloadSimple,FolderSimplePlus,ArrowsOutSimple,X,CircleNotch,FolderSimple} from '@phosphor-icons/react';
import {api,saveBlob} from '../api';
import './artifact.css';

Object.entries({python,javascript,typescript,json,sql,bash,xml,css,yaml,markdown,java}).forEach(([n,l])=>hljs.registerLanguage(n,l));
const ALIAS={js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',sh:'bash',shell:'bash',zsh:'bash',html:'xml',vue:'xml',yml:'yaml',md:'markdown'};
const NAME={python:'Python',javascript:'JavaScript',typescript:'TypeScript',json:'JSON',sql:'SQL',bash:'Shell',xml:'HTML',css:'CSS',yaml:'YAML',markdown:'Markdown',java:'Java',csv:'CSV',text:'純文字'};
const EXT={python:'py',javascript:'js',typescript:'ts',json:'json',sql:'sql',bash:'sh',xml:'html',css:'css',yaml:'yml',markdown:'md',java:'java',csv:'csv',text:'txt'};
const norm=l=>{const k=String(l||'').toLowerCase();return ALIAS[k]||k||'text'};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const safeName=s=>String(s||'').replace(/[\\/:*?"<>|\s]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'文件';

function highlight(text,lang){
  try{if(hljs.getLanguage(lang))return hljs.highlight(text,{language:lang,ignoreIllegals:true}).value}catch{/* plain */}
  return esc(text);
}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true}catch{/* fall back below */}
  const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();
  let ok=false;try{ok=document.execCommand('copy')}catch{/* denied */}a.remove();return ok;
}

/* ---- the three things every block can do besides being read */
function useBlock({text,filename,mime,ctx}){
  const [copied,setCopied]=useState(false),[full,setFull]=useState(false),[saving,setSaving]=useState(false);
  const copy=useCallback(async()=>{if(await copyText(text)){setCopied(true);setTimeout(()=>setCopied(false),1600)}else ctx.notify?.('瀏覽器不允許複製，請手動選取文字')},[text,ctx]);
  const download=useCallback(()=>{saveBlob(new Blob([text],{type:`${mime};charset=utf-8`}),filename);ctx.notify?.(`已下載 ${filename}`)},[text,filename,mime,ctx]);
  return {copied,copy,download,full,setFull,saving,setSaving};
}

function Actions({b,ctx,compact}){
  const canSave=ctx.canSave&&!ctx.live;
  const tip=ctx.live?'回答完成後才能存到空間':ctx.canSave?'存到空間':'需要建置者以上權限才能存到空間';
  return <div className="ax-actions">
    <button type="button" className={'ax-btn'+(b.copied?' done':'')} data-tip={b.copied?'已複製':'複製文字'} aria-label="複製文字" onClick={b.copy}>{b.copied?<Check size={16} weight="bold"/>:<Copy size={16}/>}</button>
    <button type="button" className="ax-btn" data-tip="下載檔案" aria-label="下載檔案" onClick={b.download}><DownloadSimple size={16}/></button>
    <button type="button" className="ax-btn" data-tip={tip} aria-label="存到空間" disabled={!canSave} onClick={()=>b.setSaving(true)}><FolderSimplePlus size={16}/></button>
    {!compact&&<button type="button" className="ax-btn" data-tip="全螢幕" aria-label="全螢幕" onClick={()=>b.setFull(true)}><ArrowsOutSimple size={16}/></button>}
  </div>;
}

function Frame({kind,title,sub,b,ctx,children,className=''}){
  return <section className={`ax ${kind} ${className}`}>
    <header className="ax-head"><span className="ax-ico">{kind==='doc'?<FileText size={15} weight="bold"/>:<Code size={15} weight="bold"/>}</span>
      <div className="ax-name"><span className="ax-title" title={title}>{title}</span>{sub&&<span className="ax-sub">{sub}</span>}</div>
      <Actions b={b} ctx={ctx}/></header>
    {children}
  </section>;
}

function FullScreen({onClose,children,title,sub,kind,b,ctx}){
  useEffect(()=>{
    const k=e=>{if(e.key==='Escape')onClose()};
    document.addEventListener('keydown',k);const o=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{document.removeEventListener('keydown',k);document.body.style.overflow=o};
  },[onClose]);
  return createPortal(<div className="ax-full" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className={`ax ${kind} big`}>
      <header className="ax-head"><span className="ax-ico">{kind==='doc'?<FileText size={15} weight="bold"/>:<Code size={15} weight="bold"/>}</span>
        <div className="ax-name"><span className="ax-title">{title}</span>{sub&&<span className="ax-sub">{sub}</span>}</div>
        <div className="ax-actions"><Actions b={b} ctx={ctx} compact/><button type="button" className="ax-btn" data-tip="關閉（Esc）" aria-label="關閉全螢幕" onClick={onClose}><X size={17}/></button></div></header>
      {children}
    </section></div>,document.body);
}

/* ---- 存到空間 */
function SaveModal({text,filename,ctx,onClose}){
  const [spaces,setSpaces]=useState(null),[pick,setPick]=useState(''),[name,setName]=useState(filename),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{
    if(ctx.mock){setSpaces([{id:'demo',name:'示範空間',type:'personal',documents_count:0}]);setPick('demo');return}
    api.listSpaces().then(l=>{const mine=l.filter(s=>['owner','admin','edit'].includes(s.my_role));setSpaces(mine);if(mine[0])setPick(mine[0].id)}).catch(e=>{setSpaces([]);setErr(e.message)});
  },[ctx.mock]);
  useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',k);return ()=>document.removeEventListener('keydown',k)},[onClose]);
  async function save(){
    setBusy(true);setErr('');
    try{
      if(!ctx.mock)await api.saveToSpace({space_id:pick,filename:name.trim(),content:text});
      ctx.notify?.(ctx.mock?'示範：已存到空間（未實際儲存）':`已存到「${spaces.find(s=>s.id===pick)?.name}」，索引完成後即可被搜尋`);onClose();
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  return createPortal(<div className="ax-modal" role="dialog" aria-modal="true" aria-label="存到空間" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="ax-dialog">
      <header><h3>存到空間</h3><button type="button" className="ax-btn" aria-label="關閉" onClick={onClose}><X size={17}/></button></header>
      <label className="ax-field">檔案名稱<input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label>
      <div className="ax-field">選擇空間
        {spaces===null?<p className="ax-muted"><CircleNotch className="spin" size={14}/> 載入中…</p>
          :!spaces.length?<p className="ax-muted">你還沒有可以編輯的空間。請先到「空間」建立一個。</p>
          :<div className="ax-spaces">{spaces.map(s=><button type="button" key={s.id} className={'ax-space'+(pick===s.id?' on':'')} aria-pressed={pick===s.id} onClick={()=>setPick(s.id)}>
            <FolderSimple size={18} weight={pick===s.id?'fill':'regular'}/><span><b>{s.name}</b><small>{s.documents_count??0} 份文件</small></span></button>)}</div>}
      </div>
      <p className="ax-muted small">內容會再次去識別化後存成知識庫文件，並建立索引，之後可以被搜尋與引用。</p>
      {err&&<p className="ax-err" role="alert">{err}</p>}
      <footer><button type="button" className="ax-ghost" onClick={onClose}>取消</button>
        <button type="button" className="ax-primary" disabled={busy||!pick||!name.trim()} onClick={save}>{busy?<><CircleNotch className="spin" size={14}/>儲存中…</>:'儲存'}</button></footer>
    </div></div>,document.body);
}

/* ---- code */
export function CodeCard({lang,text,ctx}){
  const l=norm(lang),label=NAME[l]||(lang?String(lang).toUpperCase():'程式碼');
  const filename=`code.${EXT[l]||'txt'}`;
  const b=useBlock({text,filename,mime:'text/plain',ctx});
  const html=useMemo(()=>highlight(text,l),[text,l]);
  const lines=text.split('\n').length;
  const body=<pre className="ax-code"><code className={'hljs language-'+l} dangerouslySetInnerHTML={{__html:html}}/></pre>;
  return <>
    <Frame kind="code" title={label} sub={`${lines} 行`} b={b} ctx={ctx}>{body}</Frame>
    {b.full&&<FullScreen onClose={()=>b.setFull(false)} title={label} sub={`${lines} 行`} kind="code" b={b} ctx={ctx}>{body}</FullScreen>}
    {b.saving&&<SaveModal text={text} filename={filename} ctx={ctx} onClose={()=>b.setSaving(false)}/>}
  </>;
}

/* ---- documents: ~~~document 標題 */
const plainPre=({children})=><pre>{children}</pre>;
export function DocCard({title,text,ctx}){
  const name=title||'文件',filename=`${safeName(name)}.md`;
  const b=useBlock({text,filename,mime:'text/markdown',ctx});
  const [open,setOpen]=useState(false);
  const long=text.length>700||text.split('\n').length>14;
  const md=<div className="ax-md"><Markdown remarkPlugins={[remarkGfm,remarkCjk]} components={{pre:plainPre}}>{text}</Markdown></div>;
  return <>
    <Frame kind="doc" title={name} sub="文件" b={b} ctx={ctx}>
      <div className={'ax-doc'+(open||!long?' open':'')}>{md}{long&&!open&&<div className="ax-fade"/>}</div>
      {long&&<button type="button" className="ax-more" onClick={()=>setOpen(o=>!o)}>{open?'收合':'展開全文'}</button>}
    </Frame>
    {b.full&&<FullScreen onClose={()=>b.setFull(false)} title={name} sub="文件" kind="doc" b={b} ctx={ctx}><div className="ax-read">{md}</div></FullScreen>}
    {b.saving&&<SaveModal text={text} filename={filename} ctx={ctx} onClose={()=>b.setSaving(false)}/>}
  </>;
}

/* react-markdown `pre` override: fenced code becomes a card, ~~~document becomes a document card. */
export function artifactComponents(ctx){
  return {pre:({node,children})=>{
    const code=React.Children.toArray(children)[0],props=code?.props||{};
    const m=/language-(\S+)/.exec(props.className||''),raw=m?m[1]:'';
    const text=String(props.children??'').replace(/\n$/,'');
    const meta=(node?.children?.[0]?.data?.meta||'').trim();
    if(raw==='document'||raw.startsWith('document:'))return <DocCard title={meta||raw.slice(9)} text={text} ctx={ctx}/>;
    return <CodeCard lang={raw} text={text} ctx={ctx}/>;
  }};
}
