import React,{useMemo,useRef,useState} from 'react';
import {Atom,UploadSimple,ArrowsClockwise,PencilSimple,Eye,Trash,FileArrowUp,Warning,ShieldCheck,X} from '@phosphor-icons/react';
import {api} from '../api';
import {ListToolbar,AddModal,Field,Empty} from '../ListKit';
import {errText,isBuilder,isAdmin,fmtSize,fmtTime,useOnce,Loading,Banner} from './pkit';
import './pages.css';

// Mirrors DocCategory / DEPARTMENTS in backend schemas.py.
const CATEGORIES=[['guideline','臨床診療常規指引'],['pharmacy','藥事與抗生素專冊'],['nursing_sop','護理標準作業 SOP'],['regulation','TFDA / 衛福部法規'],['other','其他']];
const CAT=Object.fromEntries(CATEGORIES);
const DEPARTMENTS=['內科部','外科部','急診醫學部','心臟血管中心','神經醫學中心','新陳代謝科','放射線部','護理部','藥劑部','感染管制中心','臨床試驗與轉譯研究中心','智慧醫療組 (IT)'];
const ACCEPT='.pdf,.txt,.md,.docx,.pptx,.html,.csv,.json';
const ST={indexing:['warn','索引中'],indexed:['ok','已索引'],error:['err','失敗']};
const canEdit=(me,d)=>!!me&&(me.role==='admin'||d.uploaded_uid===me.uid);

export default function KnowledgePage({me,notify}){
  const [docs,setDocs]=useState(null),[denied,setDenied]=useState(false);
  const [q,setQ]=useState(''),[tab,setTab]=useState('全部');
  const [cat,setCat]=useState(''),[dept,setDept]=useState(''),[needCat,setNeedCat]=useState(false);
  const [busy,setBusy]=useState(''),[over,setOver]=useState(false);
  const [edit,setEdit]=useState(null),[preview,setPreview]=useState(null);
  const fileRef=useRef(null),replaceRef=useRef(null),replaceId=useRef(null);
  const builder=isBuilder(me),admin=isAdmin(me);

  useOnce(async()=>{
    if(!builder){setDocs([]);setDenied(true);return}
    try{setDocs(await api.listDocs())}
    catch(e){setDocs([]);notify('無法載入文件：'+errText(e))}
  });

  const put=d=>setDocs(a=>a.some(x=>x.id===d.id)?a.map(x=>x.id===d.id?d:x):[d,...a]);
  const rows=useMemo(()=>{
    const s=q.trim().toLowerCase();
    return (docs||[]).filter(d=>(tab==='全部'||d.status===({'已索引':'indexed','索引中':'indexing','失敗':'error'})[tab])&&(!s||(d.name+d.department+(CAT[d.category]||'')).toLowerCase().includes(s)));
  },[docs,q,tab]);

  const upload=async list=>{
    if(!list?.length)return;
    if(!cat){setNeedCat(true);notify('請先選擇文件類別');return}
    for(const f of Array.from(list)){
      setBusy('上傳並建立索引：'+f.name);
      try{put(await api.uploadDoc(f,cat,dept));notify(`已上傳 ${f.name}`)}
      catch(e){notify(`${f.name} 上傳失敗：${errText(e)}`)}
    }
    setBusy('');
  };
  const replace=async file=>{
    const id=replaceId.current;if(!file||!id)return;
    setBusy('上傳新版本：'+file.name);
    try{put(await api.replaceDoc(id,file));notify('已建立新版本')}catch(e){notify('取代失敗：'+errText(e))}finally{setBusy('')}
  };
  const reindex=async d=>{
    setBusy('重新索引：'+d.name);
    try{put(await api.reindexDoc(d.id));notify('已重新索引')}catch(e){notify('重新索引失敗：'+errText(e))}finally{setBusy('')}
  };
  const remove=async d=>{
    if(!window.confirm(`刪除「${d.name}」？將從所有 Agent 解除附加，並刪除索引。`))return;
    try{await api.deleteDoc(d.id);setDocs(a=>a.filter(x=>x.id!==d.id));notify('已刪除文件')}catch(e){notify('刪除失敗：'+errText(e))}
  };
  const showPreview=async d=>{
    setPreview({doc:d,text:null});
    try{setPreview({doc:d,text:await api.previewDoc(d.id)})}catch(e){setPreview(null);notify('無法預覽：'+errText(e))}
  };

  if(docs===null)return <div className="lv-p"><Loading/></div>;
  return <div className="lv-p">
    <div className="page-heading"><h1><Atom/>空間</h1></div>
    <p className="subtitle">院內文件庫（共享空間上線前的過渡版本）。文件上傳後先去識別化，再擷取文字並建立向量索引，供 Agent 的知識檢索使用。</p>
    {denied&&<Banner icon={<Warning size={16}/>}>文件庫僅開放建置者（builder）與管理員使用；您目前的角色為「{me?.role||'未知'}」。</Banner>}
    {builder&&<div className={'lv-p-drop'+(over?' over':'')} onDragOver={e=>{e.preventDefault();setOver(true)}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);upload(e.dataTransfer.files)}}>
      <b style={{fontSize:13}}><FileArrowUp size={16} style={{verticalAlign:-3}}/> 拖曳檔案至此，或選擇本機檔案</b>
      <p className="lv-p-hint" style={{margin:'4px 0 0'}}>支援 PDF、DOCX、PPTX、TXT、Markdown、HTML、CSV、JSON（單檔上限以後端設定為準）。上傳後由後端同步去識別化並建立索引，大型檔案可能需要較長時間。</p>
      <div className="row">
        <select aria-label="文件類別" value={cat} style={needCat&&!cat?{borderColor:'#d9453b'}:null} onChange={e=>{setCat(e.target.value);setNeedCat(false)}}><option value="">選擇文件類別（必填）</option>{CATEGORIES.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select>
        <select aria-label="所屬科別" value={dept} onChange={e=>setDept(e.target.value)}><option value="">所屬科別（選填）</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select>
        <input ref={fileRef} type="file" multiple hidden accept={ACCEPT} onChange={e=>{upload(e.target.files);e.target.value=''}}/>
        <button className="btn primary" disabled={!!busy} onClick={()=>cat?fileRef.current.click():(setNeedCat(true),notify('請先選擇文件類別'))}><UploadSimple size={14}/>選擇檔案</button>
      </div>
      {busy&&<p className="lv-p-hint" style={{margin:'8px 0 0'}}>{busy}…</p>}
    </div>}
    <input ref={replaceRef} type="file" hidden accept={ACCEPT} onChange={e=>{replace(e.target.files[0]);e.target.value=''}}/>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋文件、科別或類別" tabs={['全部','已索引','索引中','失敗']} tab={tab} onTab={setTab}/>
    <div className="lt" style={{'--cols':'minmax(160px,1.6fr) 130px 110px 56px 90px 80px minmax(110px,1fr) 176px'}}>
      <div className="lt-head"><span>文件</span><span>類別</span><span>科別</span><span>版本</span><span>狀態</span><span>大小</span><span>使用的 Agent</span><span/></div>
      {rows.map(d=>{const [c,t]=ST[d.status]||['',d.status];const ok=canEdit(me,d);return <div className="lt-row" key={d.id}>
        <span style={{minWidth:0}}><b style={{wordBreak:'break-all'}}>{d.name}</b><div className="lv-p-meta">{d.uploaded_by||'—'} · {fmtTime(d.updated_at||d.created_at)}</div>{d.status==='error'&&d.error&&<div className="lv-p-meta" style={{color:'#b3261e'}}>{d.error}</div>}</span>
        <span>{CAT[d.category]||d.category}</span><span>{d.department||'—'}</span><span>v{d.version}</span>
        <span><span className={'lv-p-status '+c}><i/>{t}</span></span><span>{fmtSize(d.size_bytes)}</span>
        <span className="small">{d.agents?.length?d.agents.map(a=>a.name).join('、'):<span className="muted">未被使用</span>}</span>
        <span className="lt-actions">
          <button className="icon-btn" title="預覽去識別化文字" aria-label="預覽" disabled={d.status!=='indexed'} onClick={()=>showPreview(d)}><Eye/></button>
          <button className="icon-btn" title="上傳新版本" aria-label="取代版本" disabled={!ok||!!busy} onClick={()=>{replaceId.current=d.id;replaceRef.current.click()}}><FileArrowUp/></button>
          <button className="icon-btn" title="編輯類別與科別" aria-label="編輯" disabled={!ok} onClick={()=>setEdit(d)}><PencilSimple/></button>
          {admin&&<button className="icon-btn" title="重新索引（管理員）" aria-label="重新索引" disabled={!!busy} onClick={()=>reindex(d)}><ArrowsClockwise/></button>}
          <button className="icon-btn" title="刪除" aria-label="刪除" disabled={!ok} onClick={()=>remove(d)}><Trash/></button>
        </span></div>})}
      {!rows.length&&<Empty text={denied?'沒有存取權限':docs.length?'沒有符合的文件':'尚無文件，請先上傳。'}/>}
    </div>
    <div className="notice"><ShieldCheck/>只有去識別化後的文字會被索引；編輯與刪除限上傳者或管理員。去識別化的實際效果以後端處理為準，此頁面未驗證。</div>
    {edit&&<AddModal title="編輯文件資訊" hint={edit.name} submitLabel="儲存" onClose={()=>setEdit(null)} onSubmit={async f=>{
      try{put(await api.updateDoc(edit.id,f.get('category'),f.get('department')));notify('已更新');setEdit(null)}catch(e){notify('更新失敗：'+errText(e))}}}>
      <Field label="文件類別"><select name="category" defaultValue={edit.category}>{CATEGORIES.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select></Field>
      <Field label="所屬科別"><select name="department" defaultValue={edit.department||''}><option value="">（不指定）</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></Field>
    </AddModal>}
    {preview&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPreview(null)}}><div className="modal lv-p-wide" role="dialog" aria-modal="true" aria-label="去識別化預覽"><button className="icon-btn modal-close" aria-label="關閉" onClick={()=>setPreview(null)}><X/></button><h2>去識別化預覽</h2><p className="muted small">{preview.doc.name} · 後端回傳的前段文字（即送入索引的內容）</p>{preview.text===null?<Loading/>:<pre className="lv-p-pre">{preview.text||'（沒有文字內容）'}</pre>}</div></div>}
  </div>;
}
