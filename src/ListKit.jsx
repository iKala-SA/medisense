import React from 'react';
import {MagnifyingGlass,X} from '@phosphor-icons/react';

export const Toggle=({on,onChange,label})=><button type="button" role="switch" aria-checked={on} aria-label={label} className={'switch '+(on?'on':'')} onClick={()=>onChange(!on)}><span/></button>;

export function ListToolbar({search,onSearch,placeholder,tabs,tab,onTab}){
  return <div className="lt-toolbar"><label className="search"><MagnifyingGlass size={16}/><input aria-label="搜尋" placeholder={placeholder} value={search} onChange={e=>onSearch(e.target.value)}/></label><div className="tabs">{tabs.map(t=><button key={t} className={tab===t?'selected':''} onClick={()=>onTab(t)}>{t}</button>)}</div></div>;
}

export function AddModal({title,hint,submitLabel='新增',onClose,onSubmit,children}){
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={e=>{e.preventDefault();onSubmit(new FormData(e.target))}}><button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button><h2>{title}</h2>{hint&&<p className="muted small">{hint}</p>}{children}<div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary">{submitLabel}</button></div></form></div>;
}

export const Field=({label,children})=><div className="field"><label>{label}</label>{children}</div>;
export const Empty=({text})=><div className="lt-empty">{text}</div>;
