import React,{useEffect,useState} from 'react';
import {Icon} from '@iconify/react';

/* Logos are bundled offline (scripts/build-provider-icons.mjs) and loaded lazily, once, in their own chunk. */
let table=null,pending=null;
const subs=new Set();
function loadTable(){
  if(table||pending)return;
  pending=import('./providerIcons.json').then(m=>{table=m.default||m;subs.forEach(f=>f())}).catch(()=>{table={};subs.forEach(f=>f())});
}
function useBundled(service){
  const [,tick]=useState(0);
  useEffect(()=>{
    if(table)return;
    const f=()=>tick(n=>n+1);subs.add(f);loadTable();
    return()=>{subs.delete(f)};
  },[]);
  return table?table[service]||null:undefined; // undefined = still loading
}
const FAVICON=import.meta.env.VITE_ICON_FAVICON_FALLBACK!=='0';
const hostOf=u=>{try{return new URL(u).hostname}catch{return ''}};
const hue=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%360;return h};

export default function ProviderIcon({service,name,iconUrl,homepage,size=40}){
  const bundled=useBundled(service);
  const host=FAVICON?hostOf(homepage):'';
  const tiers=[iconUrl,host&&`https://www.google.com/s2/favicons?domain=${host}&sz=64`].filter(Boolean);
  const [fail,setFail]=useState(0);
  useEffect(()=>setFail(0),[service,iconUrl,homepage]);
  const inner=Math.round(size*0.6),style={width:size,height:size};
  if(bundled===undefined)return <span className="lv-gc-ico" style={style} aria-hidden="true"/>;
  if(bundled)return <span className="lv-gc-ico" style={style}><Icon icon={{body:bundled.body,width:bundled.width,height:bundled.height}} width={inner} height={inner}/></span>;
  if(fail<tiers.length)return <span className="lv-gc-ico" style={style}><img src={tiers[fail]} alt="" width={inner} height={inner} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFail(f=>f+1)}/></span>;
  const h=hue(service);
  return <span className="lv-gc-ico mono" style={{...style,fontSize:Math.round(size*0.42),background:`hsl(${h} 45% 90%)`,color:`hsl(${h} 55% 25%)`}}>{(name||service||'?').trim().charAt(0).toUpperCase()}</span>;
}
