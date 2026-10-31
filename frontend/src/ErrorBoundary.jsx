import React from 'react';

/* A page that throws (or a lazy chunk that no longer exists after a deploy) must not leave the whole app white. */
export default class ErrorBoundary extends React.Component{
  state={err:null};
  static getDerivedStateFromError(err){return {err}}
  componentDidCatch(err,info){console.error('page crashed:',err,info?.componentStack)}
  componentDidUpdate(prev){if(this.state.err&&prev.resetKey!==this.props.resetKey)this.setState({err:null})}
  render(){
    const {err}=this.state;
    if(!err)return this.props.children;
    const stale=/dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch|Unable to preload/i.test(String(err?.message||err));
    return <div role="alert" style={{maxWidth:520,margin:'80px auto',padding:'0 24px',textAlign:'center',color:'#1c2a23'}}>
      <h2 style={{fontSize:18,margin:'0 0 8px'}}>{stale?'有新版本，請重新載入':'這一頁發生錯誤'}</h2>
      <p style={{fontSize:13.5,color:'#5b6b63',lineHeight:1.6,margin:'0 0 16px'}}>{stale?'系統剛更新過，這個分頁還在使用舊版本。重新載入即可。':'其他頁面不受影響。你可以重新載入，或回到對話。若一直發生，請把下方訊息回報給管理員。'}</p>
      <div style={{display:'flex',gap:8,justifyContent:'center'}}>
        <button className="btn primary" onClick={()=>location.reload()}>重新載入</button>
        {!stale&&this.props.onHome&&<button className="btn" onClick={()=>{this.setState({err:null});this.props.onHome()}}>回到對話</button>}
      </div>
      {!stale&&<pre style={{marginTop:18,fontSize:11.5,color:'#8a919c',whiteSpace:'pre-wrap',wordBreak:'break-word',textAlign:'left'}}>{String(err?.message||err).slice(0,300)}</pre>}
    </div>;
  }
}
