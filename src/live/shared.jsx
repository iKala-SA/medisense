import React from 'react';
import {SpinnerGap,TrendUp,TrendDown} from '@phosphor-icons/react';
import './admin.css';

export const Loading=({text='載入中…'})=><div className="lv-loading"><SpinnerGap className="lv-spin" size={18}/>{text}</div>;

export const Notice=({tone,icon,children})=><div className={'lv-notice '+(tone||'')}>{icon}<div>{children}</div></div>;

export function Kpi({label,value,unit,foot,rows,tone,onClick,children}){
  const Tag=onClick?'button':'div';
  return <Tag type={onClick?'button':undefined} className={'lv-kpi '+(tone||'')} onClick={onClick}>
    <span className="lv-kpi-label">{label}</span>
    <span className="lv-kpi-value">{value}{unit&&<small>{unit}</small>}</span>
    {foot&&<span className="lv-kpi-foot">{foot}</span>}
    {children}
    {rows&&rows.length>0&&<div className="lv-kpi-rows">{rows.map((r,i)=><div key={i} className={'lv-kpi-row '+(r.tone||'')}><span>{r.k}</span><b>{r.v}</b></div>)}</div>}
  </Tag>;
}

export const Delta=({pct,invert})=>{
  if(pct==null)return <span>無上期資料</span>;
  const good=invert?pct<=0:pct>=0;
  return <span className={good?'lv-up':'lv-down'}>{pct>=0?<TrendUp size={13}/>:<TrendDown size={13}/>} {pct>=0?'+':''}{pct}%</span>;
};
