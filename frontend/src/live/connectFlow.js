import {api} from '../api';
import {errText} from './pkit';

const detail=e=>errText(e).replace(/^\d{3}\s*/,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* Per-user OAuth: open the provider consent page in a popup, then poll the connector status until connected.
   The popup is opened synchronously (inside the click handler) so browsers do not block it.
   Resolves with the final status item when connected, otherwise null. */
export async function connectAccount(id,notify){
  const w=520,h=680,left=Math.max(0,Math.round(window.screenX+(window.outerWidth-w)/2)),top=Math.max(0,Math.round(window.screenY+(window.outerHeight-h)/2));
  const popup=window.open('about:blank','medisense_oauth',`width=${w},height=${h},left=${left},top=${top},popup=yes`);
  if(!popup){notify('瀏覽器封鎖了彈出視窗，請允許此網站的彈出視窗後再試一次');return null}
  try{popup.document.title='連線中…';popup.document.body.innerText='正在前往授權頁面…'}catch{/* cross-origin not yet */}
  let url;
  try{url=(await api.connectMine(id)).authorization_url}
  catch(e){popup.close();notify('無法開始連線：'+detail(e));return null}
  if(!url){popup.close();notify('後端未回傳授權網址');return null}
  popup.location.href=url;
  const deadline=Date.now()+120000;
  let closedChecked=false;
  while(Date.now()<deadline){
    await sleep(2000);
    const closed=popup.closed;
    try{
      const s=await api.myConnectorStatus(id);
      if(s?.state==='connected'){try{popup.close()}catch{/* */}notify('已連線'+(s.account_label?'：'+s.account_label:''));return s}
    }catch(e){/* transient: keep polling */}
    if(closed){if(closedChecked)break;closedChecked=true;break}
  }
  try{popup.close()}catch{/* */}
  notify('尚未完成授權。如已授權，請重新整理狀態。');
  return null;
}
export const connectErr=detail;
