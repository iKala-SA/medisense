import {useEffect,useState} from 'react';
import {ImageBroken} from '@phosphor-icons/react';
import {api} from './api';

/* One image above a sent user message. Just sent: the local preview (a.url). Reopened conversation: the stored, redacted
   copy, fetched with the bearer token (GET /api/chat/attachments/{sid}/{id}/image, owner only). Removed or expired
   (410 / 404 / any failure): a small grey tile instead of a broken image. */
export function ChatImage({a}){
  const [src,setSrc]=useState(a.url||''),[gone,setGone]=useState(!a.url&&a.available===false);
  useEffect(()=>{
    if(a.url||!a.sid||!a.id||a.available===false)return;
    let live=true,url='';
    api.chatImage(a.sid,a.id).then(b=>{if(!live)return;url=URL.createObjectURL(b);setSrc(url)}).catch(()=>live&&setGone(true));
    return()=>{live=false;if(url)URL.revokeObjectURL(url)};
  },[a.url,a.sid,a.id,a.available]);
  if(gone)return <div className="um-img-gone" title={a.name||'圖片'}><ImageBroken size={18}/><span>圖片已過期</span></div>;
  if(!src)return <div className="um-img-gone loading" aria-label="載入圖片中"/>;
  return <img src={src} alt={a.name||'圖片'} onError={()=>setGone(true)}/>;
}
