import React,{useState} from 'react';
import {Plus,Trash} from '@phosphor-icons/react';
import {api} from '../api';
import {AgentCreate} from '../AgentCreate';
import {Toggle,ListToolbar,Empty} from '../ListKit';
import {ShareDialog,ShareChip} from './ShareLive';
import {errText} from './kit';
import {isBuilder as isBuilderRole} from './pkit';
import {canEdit,canOwn,fmtDate,match,sameShare,useLoad,State,ROLE_LABEL} from './workkit';
import './work.css';

/** 技能 (live). Props: me = GET /api/me; notify(message). */
export default function SkillsPage({me,notify}){
  const [items,setItems,reload,err]=useLoad(api.listSkills,'技能',notify);
  const [q,setQ]=useState(''),[tab,setTab]=useState('全部'),[view,setView]=useState(null),[sharing,setSharing]=useState(null),[busy,setBusy]=useState(false);
  const builder=isBuilderRole(me);
  const put=s=>setItems(a=>(a||[]).map(x=>x.id===s.id?{...x,...s}:x));

  const save=async v=>{
    if(busy)return;setBusy(true);
    try{
      const body={name:v.name,description:v.desc,instructions:v.instr};
      if(view==='new'){
        let s=await api.createSkill({...body,enabled:true});
        if(v.share&&!sameShare(v.share,{access:'restricted',role:'use',members:[]})){
          try{s=await api.shareSkill(s.id,v.share)}catch(e){notify('技能已建立，但分享設定失敗：'+errText(e))}
        }
        setItems(a=>[s,...(a||[])]);notify('已建立技能');
      }else{
        let s=await api.updateSkill(view.id,{...body,enabled:view.enabled});
        if(canOwn(view)&&!sameShare(v.share,view.share)){
          try{s=await api.shareSkill(view.id,v.share)}catch(e){notify('技能已更新，但分享設定失敗：'+errText(e))}
        }
        put(s);notify('已更新技能');
      }
      setView(null);
    }catch(e){notify('儲存失敗：'+errText(e))}
    finally{setBusy(false)}
  };
  const toggle=async(s,on)=>{
    put({id:s.id,enabled:on});
    try{put(await api.setSkillEnabled(s.id,on))}catch(e){put({id:s.id,enabled:!on});notify('切換失敗：'+errText(e))}
  };
  const del=async s=>{
    if(!window.confirm(`刪除技能「${s.name}」？此動作無法復原。`))return;
    try{await api.deleteSkill(s.id);setItems(a=>a.filter(x=>x.id!==s.id));notify('已刪除技能')}catch(e){notify('刪除失敗：'+errText(e))}
  };

  if(view)return <AgentCreate key={view==='new'?'new':view.id} creator={view==='new'?(me.name||me.email):(view.owner_email||me.email)} backLabel="技能" noun="技能" status={view==='new'||view.enabled?'啟用':'停用'} instrLabel="技能指示" selects={[]}
    initial={view==='new'?undefined:{name:view.name,desc:view.description,instr:view.instructions,share:view.share}} shareDialog={ShareDialog}
    onCancel={()=>setView(null)} onSave={view!=='new'&&!canEdit(view)?()=>setView(null):save}/>;

  const rows=(items||[]).filter(s=>(tab==='全部'||(tab==='已啟用')===!!s.enabled)&&match(s.name+(s.description||''),q));
  const sharingItem=sharing&&(items||[]).find(x=>x.id===sharing);
  return <>
    <div className="page-heading"><h1>技能</h1>{builder&&<button className="btn primary" onClick={()=>setView('new')}><Plus/>新增技能</button>}</div>
    <p className="subtitle">可重複使用的工作能力，供 Agent 在授權範圍內呼叫。{!builder&&'（你的角色僅能檢視與使用，建立需要建構者權限。）'}</p>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋技能" tabs={['全部','已啟用','已停用']} tab={tab} onTab={setTab}/>
    {items===null?<State/>:err&&!items.length?<State err={err} onRetry={reload}/>:
    <div className="lt" style={{'--cols':'minmax(150px,1fr) minmax(200px,2fr) 150px 140px 70px 44px'}}>
      <div className="lt-head"><span>名稱</span><span>說明</span><span>分享對象</span><span>最後更新</span><span>啟用</span><span/></div>
      {rows.map(s=><div className="lt-row" key={s.id}>
        <span><button className="text-button" onClick={()=>setView(s)} title={canEdit(s)?'編輯':'檢視'}><b>{s.name}</b></button> <span className="lv-w-role">{ROLE_LABEL[s.my_role]||s.my_role}</span></span>
        <span className="muted">{s.description||'—'}</span>
        <ShareChip share={s.share} label={'分享 '+s.name} onClick={()=>setSharing(s.id)}/>
        <span className="muted small">{fmtDate(s.updated_at)}</span>
        {canEdit(s)&&builder?<Toggle on={!!s.enabled} label={'啟用 '+s.name} onChange={v=>toggle(s,v)}/>:<span className="muted small">{s.enabled?'啟用':'停用'}</span>}
        {canOwn(s)?<button className="icon-btn" aria-label={'刪除 '+s.name} onClick={()=>del(s)}><Trash/></button>:<span/>}
      </div>)}
      {!rows.length&&<Empty text={items.length?'沒有符合的技能':'還沒有技能'}/>}
    </div>}
    {sharingItem&&<ShareDialog title={sharingItem.name} value={sharingItem.share} owner={sharingItem.owner_email||me.email}
      onClose={()=>setSharing(null)} onDone={async v=>{
        if(!canOwn(sharingItem)){notify('只有擁有者或管理員可以變更分享設定');setSharing(null);return}
        try{put(await api.shareSkill(sharingItem.id,v));notify('已更新分享設定');setSharing(null)}catch(e){notify('分享設定失敗：'+errText(e))}
      }}/>}
  </>;
}
