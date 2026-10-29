import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {REF} from './stepkit';

/* A prompt box where typing "@" lists the EARLIER steps and picks one as a chip (PRD §6.3). The text is stored with {{step_id}}
   (so renaming a step never breaks a reference) and shown with @title chips. A chip whose step is gone or comes later turns red. */
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toHTML(value,steps,ids){
  let html='',at=0;const v=value||'';
  for(const m of v.matchAll(REF)){
    html+=esc(v.slice(at,m.index)).replace(/\n/g,'<br>');
    const ref=m[1]+(m[2]?'.'+m[2]:''),st=steps.find(s=>s.id===m[1]),ok=!!st;
    html+=`<span class="mt${ok?'':' bad'}" contenteditable="false" data-ref="${esc(ref)}">@${esc(st?st.title+(m[2]?'.'+m[2]:''):'已刪除或在後面的 Step')}</span>`;
    at=m.index+m[0].length;
  }
  return html+esc(v.slice(at)).replace(/\n/g,'<br>');
}
function fromDOM(el){
  let out='';
  const walk=(n,first)=>{
    n.childNodes.forEach((c,i)=>{
      if(c.nodeType===3)out+=c.nodeValue.replace(/​/g,'');
      else if(c.nodeName==='BR')out+='\n';
      else if(c.classList?.contains('mt'))out+=`{{${c.dataset.ref}}}`;
      else if(c.nodeName==='DIV'||c.nodeName==='P'){if(out&&!out.endsWith('\n'))out+='\n';walk(c)}
      else walk(c);
    });
  };
  walk(el);return out;
}

/** steps = the steps this prompt may reference (those before the current one). */
export default function MentionEditor({value,onChange,steps,placeholder,rows=3,invalid=false}){
  const ref=useRef(null),last=useRef(null),[pop,setPop]=useState(null),[sel,setSel]=useState(0);
  const ids=steps.map(s=>s.id).join(',');
  useLayoutEffect(()=>{ // only re-render the DOM when the value changed from outside (typing keeps the caret)
    if(ref.current&&value!==last.current){ref.current.innerHTML=toHTML(value,steps,ids);last.current=value}
  },[value,ids,steps.map(s=>s.title).join('|')]);// eslint-disable-line react-hooks/exhaustive-deps
  const emit=()=>{const v=fromDOM(ref.current);last.current=v;onChange(v)};
  const query=()=>{
    const s=window.getSelection();if(!s.rangeCount||!ref.current.contains(s.anchorNode)||s.anchorNode.nodeType!==3)return null;
    const t=s.anchorNode.nodeValue.slice(0,s.anchorOffset),m=/@([^\s@]*)$/.exec(t);
    return m?{q:m[1],node:s.anchorNode,end:s.anchorOffset,start:s.anchorOffset-m[0].length}:null;
  };
  const options=q=>steps.filter(s=>s.title.toLowerCase().includes(q.toLowerCase())).slice(0,8);
  const onInput=()=>{emit();const q=query();if(q&&options(q.q).length){setPop(q);setSel(0)}else setPop(null)};
  const pick=(st)=>{
    const q=pop||query();if(!q)return;
    const r=document.createRange();r.setStart(q.node,q.start);r.setEnd(q.node,q.end);r.deleteContents();
    const chip=document.createElement('span');chip.className='mt';chip.contentEditable='false';chip.dataset.ref=st.id;chip.textContent='@'+st.title;
    r.insertNode(chip);const sp=document.createTextNode(' ');chip.after(sp);
    const s=window.getSelection(),nr=document.createRange();nr.setStart(sp,1);nr.collapse(true);s.removeAllRanges();s.addRange(nr);
    setPop(null);emit();
  };
  const list=pop?options(pop.q):[];
  const onKey=e=>{
    if(pop&&list.length){
      if(e.key==='ArrowDown'){e.preventDefault();setSel(i=>(i+1)%list.length)}
      else if(e.key==='ArrowUp'){e.preventDefault();setSel(i=>(i-1+list.length)%list.length)}
      else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();pick(list[sel])}
      else if(e.key==='Escape'){e.preventDefault();setPop(null)}
    }
  };
  return <div className="mt-wrap">
    <div ref={ref} className={'mt-edit'+(invalid?' invalid':'')} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder={placeholder}
      style={{minHeight:rows*22}} onInput={onInput} onKeyDown={onKey} onBlur={()=>setTimeout(()=>setPop(null),150)}
      onPaste={e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'))}}/>
    {pop&&list.length>0&&<div className="mt-pop" role="listbox">{list.map((s,i)=><button key={s.id} type="button" role="option" aria-selected={i===sel} className={i===sel?'on':''} onMouseDown={e=>{e.preventDefault();pick(s)}}><b>@{s.title}</b></button>)}</div>}
    {!steps.length&&<small className="mt-hint">在前面加入 Step 後，輸入 @ 就能引用它的輸出。</small>}
  </div>;
}
