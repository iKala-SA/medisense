import React,{useEffect,useRef,useState} from 'react';
import {X,Microphone,MicrophoneSlash} from '@phosphor-icons/react';
import './voicechat.css';

const SR=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);
export const voiceChatSupported=!!SR&&typeof window!=='undefined'&&'speechSynthesis' in window;
// what is spoken: no markdown marks, no [1] citation markers, no links
const plain=t=>String(t||'').replace(/```[\s\S]*?```/g,' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[\d+\]/g,'').replace(/[#*_`>|~]/g,'').replace(/([。！？!?：:；;，,])\s*\n+\s*/g,'$1').replace(/\s*\n+\s*/g,'。').replace(/(^|。)\s*(\d+[.、)]|[-•])\s*/g,'$1').replace(/。{2,}/g,'。').replace(/[：:]。/g,'：').replace(/^[。\s]+|\s+$/g,'');
// Chrome stops long utterances after ~15 s, so speak sentence by sentence
const chunks=t=>{const out=[];let cur='';for(const s of t.split(/(?<=[。！？!?；;])/)){if((cur+s).length>110&&cur){out.push(cur);cur=s}else cur+=s}if(cur.trim())out.push(cur);return out};
const pickVoice=lang=>{const vs=window.speechSynthesis.getVoices().filter(v=>v.lang.replace('_','-').toLowerCase().startsWith(lang.toLowerCase().split('-')[0]));return vs.find(v=>v.lang.replace('_','-')===lang&&v.localService)||vs.find(v=>v.lang.replace('_','-')===lang)||vs.find(v=>v.localService)||vs[0]||null};

/* 語音對話 (turn-based), shown inside the conversation like ChatGPT: what you say is printed live as your message; when you pause it
   goes through the normal chat (de-identified, agents, databases) and the reply streams in as text and is read aloud; then it listens
   again. Tap the circle to interrupt the reply or to pause / resume the microphone. */
export default function VoiceChat({ask,onClose,notify,onHeard}){
  const [st,setSt]=useState('listening'),[paused,setPaused]=useState(false);
  const setHeard=t=>onHeard?.(t);
  const alive=useRef(true),rec=useRef(null),pausedRef=useRef(false),stRef=useRef('listening');
  const lang=(()=>{try{const v=localStorage.getItem('ms.voice');return v&&v!=='auto'?v:'zh-TW'}catch{return 'zh-TW'}})();
  const set=s=>{stRef.current=s;setSt(s)};

  function listen(){
    if(!alive.current||pausedRef.current||rec.current)return;
    const r=new SR();let got='';
    r.lang=lang;r.interimResults=true;r.continuous=false;
    r.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;setHeard(t);if(e.results[e.results.length-1].isFinal)got=t};
    r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){notify('無法使用麥克風：請在瀏覽器允許這個網站使用麥克風');onClose()}};
    r.onend=()=>{rec.current=null;if(!alive.current)return;if(got.trim())handle(got.trim());else if(!pausedRef.current)setTimeout(listen,250)};
    rec.current=r;set('listening');setHeard('');
    try{r.start()}catch{setTimeout(listen,400)}
  }
  // The reply is spoken WHILE it is still being written: complete sentences are queued as they arrive.
  const spk=useRef(null);
  function makeSpeaker(){
    const synth=window.speechSynthesis,voice=pickVoice(lang);
    const o={buf:'',cur:'',pending:0,spoke:false,done:false,dead:false};
    const end=()=>{o.pending=Math.max(0,o.pending-1);if(!o.dead&&o.done&&o.pending===0&&alive.current)listen()};
    const say=t=>{const parts=chunks(plain(t));for(const p of parts){const u=new SpeechSynthesisUtterance(p);u.lang=lang;if(voice)u.voice=voice;u.rate=1.05;
      u.onend=end;u.onerror=end;o.pending++;o.spoke=true;if(stRef.current!=='speaking')set('speaking');synth.speak(u)}};
    o.feed=d=>{if(o.dead)return;o.buf+=d;let i;
      while((i=o.buf.search(/[。！？!?；;\n]/))>=0){o.cur+=o.buf.slice(0,i+1);o.buf=o.buf.slice(i+1);if(o.cur.replace(/\s/g,'').length>=14){say(o.cur);o.cur=''}}};
    o.finish=full=>{if(o.dead)return;const rest=o.cur+o.buf;o.cur=o.buf='';
      if(!o.spoke&&!rest.trim())say(full||'');else if(rest.trim())say(rest);
      o.done=true;if(o.pending===0&&alive.current)listen()};
    o.stop=()=>{o.dead=true;synth.cancel()};
    return o;
  }
  async function handle(text){
    set('thinking');setHeard('');
    spk.current?.stop();const sp=spk.current=makeSpeaker();
    let out='';try{out=await ask(text,d=>sp.feed(d))}catch{/* shown by the chat itself */}
    if(!alive.current||sp.dead)return;
    sp.finish(out);
  }
  function tapOrb(){
    if(stRef.current==='speaking'||stRef.current==='thinking'){spk.current?.stop();set('listening');listen();return}       // interrupt the reply
    if(stRef.current==='listening'||paused){pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);
      if(pausedRef.current){try{rec.current?.abort()}catch{/* stopped */}set('paused')}else listen()}
  }
  useEffect(()=>{
    alive.current=true;window.speechSynthesis.getVoices();listen();
    const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);
    return()=>{alive.current=false;onHeard?.('');window.removeEventListener('keydown',k);try{rec.current?.abort()}catch{/* stopped */}spk.current?.stop();window.speechSynthesis.cancel()};
  },[]);// eslint-disable-line react-hooks/exhaustive-deps
  const label={listening:'聆聽中…',thinking:'思考中…',speaking:'回覆中・點圓球可打斷',paused:'已暫停・點圓球繼續'}[st]||'';
  return <div className="vb" role="group" aria-label="語音對話">
    <button type="button" className={'vb-orb '+st} aria-label={label} title={label} onClick={tapOrb}/>
    <div className="vb-bar"><span className="vb-state" role="status">{label}</span>
      <button type="button" className={'vb-btn'+(paused?' off':'')} aria-label={paused?'開啟麥克風':'暫停麥克風'} title={paused?'開啟麥克風':'暫停麥克風'} onClick={()=>{if(stRef.current==='speaking'||stRef.current==='thinking')spk.current?.stop();pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);if(pausedRef.current){try{rec.current?.abort()}catch{/* stopped */}set('paused')}else{set('listening');listen()}}}>{paused?<MicrophoneSlash size={20}/>:<Microphone size={20}/>}</button>
      <button type="button" className="vb-end" aria-label="結束語音對話" title="結束語音對話" onClick={onClose}><X size={18} weight="bold"/></button></div>
    <small className="vb-note">語音經瀏覽器的語音服務辨識；內容會先去識別化。</small>
  </div>;
}
