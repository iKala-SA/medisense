import React,{useEffect,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjk from 'remark-cjk-friendly';
import {ShieldCheck,ImageSquare,LinkBreak} from '@phosphor-icons/react';
import {MOCK} from './firebase';
import {SignInButtons} from './SignIn';
import {useAuth} from './useAuth';
import {Who} from './live/ChatAnswer';
import {shareApi,fmtDate} from './ChatShare';

/* /share/:id — read-only view of a shared conversation (de-identified snapshot). Any signed-in platform user may open it;
   the server checks the sign-in, expiry and revocation, and audits every view. */
export default function SharePage({id}){
  const [logged,setLogged]=useState(MOCK),[data,setData]=useState(null),[err,setErr]=useState('');
  const {authError,checking,setAuthError}=useAuth({onSignedIn:()=>setLogged(true),onSignedOut:()=>setLogged(false)});
  useEffect(()=>{if(!logged)return;let live=true;shareApi(MOCK).view(id).then(d=>live&&setData(d)).catch(e=>live&&setErr(e.message));return()=>{live=false}},[logged,id]);
  useEffect(()=>{document.title=data?.title?`${data.title} · Medisense`:'分享的對話 · Medisense'},[data]);
  if(!logged)return <div className="lg-screen"><div className="lg-center"><div className="lg-brand"><img className="lg-mark" src="/brand/logo-mark.png" alt=""/><b>Medisense</b></div>
    {checking?<p className="lg-note">正在確認身分…</p>:<><p className="sv-login-note">登入後即可檢視分享給你的對話</p><SignInButtons onError={setAuthError}/></>}
    {authError&&<p className="login-error" role="alert">{authError}</p>}</div></div>;
  return <div className="sv-page">
    <header className="sv-top"><a className="sv-brand" href="/"><img src="/brand/logo-mark.png" alt=""/><b>Medisense</b></a><a className="sv-home" href="/">開啟 Medisense</a></header>
    {err?<div className="sv-gone"><LinkBreak size={30}/><h1>{/404/.test(err)?'這個分享連結已失效':'無法開啟分享'}</h1><p>{/404/.test(err)?'連結可能已被撤銷、超過 30 天，或原對話已刪除。':err}</p></div>
    :!data?<p className="sv-loading">載入中…</p>
    :<main className="conversation sv-main">
      <div className="sv-head"><h1>{data.title||'分享的對話'}</h1>
        <p><span>由 {data.owner_name} 分享</span><span className="sv-badge"><ShieldCheck size={13}/>已去識別化</span><span>到期日 {fmtDate(data.expires_at)}</span></p>
        <small>唯讀快照：內容為 {fmtDate(data.created_at)} 分享時的對話，個人資料已遮蔽。</small></div>
      {data.attachments>0&&<p className="sv-att"><ImageSquare size={15}/>原對話含 {data.attachments} 個附件或圖片，未包含在分享內容中。</p>}
      <div className="messages sv-msgs">{data.messages.map((m,i)=>m.role==='user'
        ?<div key={i} className="exchange sv-user"><div className="user-message">{m.content}</div></div>
        :<div key={i} className="exchange"><div className="answer"><div className="cx-answer"><Who/><div className="cx-md"><Markdown remarkPlugins={[remarkGfm,remarkCjk]} components={{a:({href,children})=><a href={href} target="_blank" rel="noreferrer">{children}</a>,table:({children})=><div className="cx-table"><table>{children}</table></div>}}>{m.content}</Markdown></div></div></div></div>)}</div>
      <p className="sv-foot">AI 回覆可能有誤，請查核。此頁面的每次檢視都會記錄在稽核紀錄。</p>
    </main>}
  </div>;
}
