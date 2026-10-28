import React,{useRef,useState} from 'react';

/* Drag handle on the sidebar's right edge. The width lives in a CSS variable (--side-w) on .shell and is remembered. */
const KEY='medisense.sidebar.width',MIN=232,MAX=480,DEFAULT=288;
const clamp=n=>Math.max(MIN,Math.min(MAX,Math.round(n)));
export const loadSideWidth=()=>{try{const n=+localStorage.getItem(KEY);return n?clamp(n):DEFAULT}catch{return DEFAULT}};
export function SideResizer({width,setWidth}){
  const [drag,setDrag]=useState(false),start=useRef(null);
  const save=w=>{try{localStorage.setItem(KEY,String(w))}catch{}};
  return <div className={'side-resizer'+(drag?' dragging':'')} role="separator" aria-orientation="vertical" aria-label="調整側邊欄寬度" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width} tabIndex={0}
    title="拖曳調整寬度；連點兩下還原"
    onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);start.current={x:e.clientX,w:width};setDrag(true);document.body.classList.add('side-resizing')}}
    onPointerMove={e=>{if(start.current)setWidth(clamp(start.current.w+e.clientX-start.current.x))}}
    onPointerUp={e=>{if(!start.current)return;const w=clamp(start.current.w+e.clientX-start.current.x);start.current=null;setDrag(false);document.body.classList.remove('side-resizing');setWidth(w);save(w)}}
    onDoubleClick={()=>{setWidth(DEFAULT);save(DEFAULT)}}
    onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const w=clamp(width+(e.key==='ArrowRight'?16:-16));setWidth(w);save(w)}}}/>;
}
