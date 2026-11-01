import React,{useEffect,useRef,useState} from 'react';
import {X,Microphone,MicrophoneSlash,SpeakerHigh,Check,Play,CaretUp} from '@phosphor-icons/react';
import {api} from '../api';
import './voicechat.css';

const SR=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);
export const voiceChatSupported=!!SR&&typeof window!=='undefined'&&'speechSynthesis' in window;
const PAUSE_MS=900;      // silence after your last word that ends your turn
const ls=(k,d)=>{try{return localStorage.getItem(k)??d}catch{return d}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch{/* private mode */}};
// what is spoken: no markdown marks, no [1] citation markers, no links, no list numbers
const plain=t=>String(t||'').replace(/```[\s\S]*?```/g,' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[\d+\]/g,'').replace(/[#*_`>|~]/g,'').replace(/([。！？!?：:；;，,])\s*\n+\s*/g,'$1').replace(/\s*\n+\s*/g,'。').replace(/(^|。)\s*(\d+[.、)]|[-•])\s*/g,'$1').replace(/。{2,}/g,'。').replace(/[：:]。/g,'：').replace(/^[。\s]+|\s+$/g,'');
const chunks=t=>{const out=[];let cur='';for(const s of t.split(/(?<=[。！？!?；;])/)){if((cur+s).length>110&&cur){out.push(cur);cur=s}else cur+=s}if(cur.trim())out.push(cur);return out};
const browserVoice=lang=>{const vs=window.speechSynthesis.getVoices().filter(v=>v.lang.replace('_','-').toLowerCase().startsWith('zh'));return vs.find(v=>v.lang.replace('_','-')===lang&&v.localService)||vs.find(v=>v.lang.replace('_','-')===lang)||vs[0]||null};
const GROUPS=[['chirp','擬真語音（Chirp 3 HD・普通話口音）'],['wavenet','台灣華語（反應最快）']];

/* 語音對話, shown inside the conversation: your words print live as your message; after a short pause they go through the normal chat
   (de-identified, agents, databases); the reply streams in as text and is spoken sentence by sentence while it is still being written,
   in the voice you picked. Recognition is started ONCE for the whole conversation (restarting it each turn costs 1–3 s); replies are
   scheduled on one audio clock so the sentences join without gaps. Tap the orb to interrupt or pause. */
export default function VoiceChat({ask,onClose,notify,onHeard}){
  const [st,setSt]=useState('listening'),[paused,setPaused]=useState(false),[menu,setMenu]=useState(false);
  const [voices,setVoices]=useState(null),[voice,setVoice]=useState(()=>ls('ms.tts.voice','')),[barge,setBarge]=useState(()=>ls('ms.tts.barge','0')==='1'),[prev,setPrev]=useState('');
  const alive=useRef(true),rec=useRef(null),pausedRef=useRef(false),stRef=useRef('listening'),spk=useRef(null),ctx=useRef(null),nextAt=useRef(0),srcs=useRef(new Set());
  const base=useRef(0),timer=useRef(null),heard=useRef(''),ignoreUntil=useRef(0),voiceRef=useRef(voice),bargeRef=useRef(barge),cloudOk=useRef(true);
  const lang=(()=>{const v=ls('ms.voice','auto');return v&&v!=='auto'?v:'zh-TW'})();
  const set=s=>{stRef.current=s;setSt(s)};
  voiceRef.current=voice;bargeRef.current=barge;

  // ---- speaking ---------------------------------------------------------------------------------------------------
  function audioCtx(){const C=window.AudioContext||window.webkitAudioContext;if(!ctx.current)ctx.current=new C();if(ctx.current.state==='suspended')ctx.current.resume();return ctx.current}
  function stopAudio(){srcs.current.forEach(s=>{try{s.stop()}catch{/* ended */}});srcs.current.clear();nextAt.current=0;window.speechSynthesis.cancel()}
  async function cloudBuffer(text,vid){const data=await api.ttsAudio(text,vid,1.05);return audioCtx().decodeAudioData(data)}
  function playBuffer(buf,onEnd){
    const c=audioCtx(),src=c.createBufferSource();src.buffer=buf;src.connect(c.destination);
    const at=Math.max(c.currentTime+0.03,nextAt.current);src.start(at);nextAt.current=at+buf.duration;
    srcs.current.add(src);src.onended=()=>{srcs.current.delete(src);onEnd()};
  }
  function playBrowser(text,onEnd){const u=new SpeechSynthesisUtterance(text);u.lang=lang;const v=browserVoice(lang);if(v)u.voice=v;u.rate=1.05;u.onend=onEnd;u.onerror=onEnd;window.speechSynthesis.speak(u)}
  const usingCloud=()=>voiceRef.current&&voiceRef.current!=='browser'&&cloudOk.current;

  function makeSpeaker(){
    const o={buf:'',cur:'',jobs:[],idx:0,live:0,spoke:false,done:false,dead:false,pumping:false};
    const finishCheck=()=>{if(!o.dead&&o.done&&o.idx>=o.jobs.length&&o.live===0&&!o.pumping&&alive.current)backToListening()};
    const start=text=>{
      if(usingCloud()){const vid=voiceRef.current;return cloudBuffer(text,vid).then(b=>({b}),()=>{if(cloudOk.current){cloudOk.current=false;notify('雲端語音暫時無法使用，改用瀏覽器內建語音')}return {t:text}})}
      return Promise.resolve({t:text});
    };
    async function pump(){
      if(o.pumping)return;o.pumping=true;
      while(o.idx<o.jobs.length&&!o.dead){const j=await o.jobs[o.idx++];if(o.dead)break;o.live++;if(stRef.current!=='speaking')set('speaking');
        const end=()=>{o.live--;finishCheck()};j.b?playBuffer(j.b,end):playBrowser(j.t,end)}
      o.pumping=false;finishCheck();
    }
    const say=text=>{for(const p of chunks(plain(text))){o.jobs.push(start(p));o.spoke=true}pump()};
    // the first sentence goes out early (short), later ones are batched a little longer
    o.feed=d=>{if(o.dead)return;o.buf+=d;let i;
      while((i=o.buf.search(/[。！？!?；;\n]/))>=0){o.cur+=o.buf.slice(0,i+1);o.buf=o.buf.slice(i+1);if(o.cur.replace(/\s/g,'').length>=(o.spoke?14:6)){say(o.cur);o.cur=''}}};
    o.finish=full=>{if(o.dead)return;const rest=o.cur+o.buf;o.cur=o.buf='';
      if(!o.spoke&&!rest.trim())say(full||'');else if(rest.trim())say(rest);
      o.done=true;if(o.jobs.length===0)backToListening();else pump()};
    o.stop=()=>{o.dead=true;stopAudio()};
    return o;
  }
  function backToListening(){if(!alive.current)return;ignoreUntil.current=Date.now()+450;heard.current='';onHeard?.('');set(pausedRef.current?'paused':'listening')}
  async function handle(text){
    set('thinking');onHeard?.('');
    spk.current?.stop();const sp=spk.current=makeSpeaker();
    let out='';try{out=await ask(text,d=>sp.feed(d))}catch{/* shown by the chat itself */}
    if(!alive.current||sp.dead)return;
    sp.finish(out);
  }
  function interrupt(){spk.current?.stop();backToListening()}

  // ---- listening: ONE continuous recognition for the whole conversation -----------------------------------------------
  function startRec(){
    if(!alive.current||pausedRef.current||rec.current)return;
    const r=new SR();r.lang=lang;r.continuous=true;r.interimResults=true;base.current=0;
    r.onresult=e=>{
      const len=e.results.length;let t='';for(let i=base.current;i<len;i++)t+=e.results[i][0].transcript;
      if(stRef.current!=='listening'){
        if(stRef.current==='speaking'&&bargeRef.current&&t.trim().length>=2){interrupt()}   // talking over the reply (wear headphones)
        else{base.current=len;return}                                                        // speaker echo / chatter while busy
      }
      if(Date.now()<ignoreUntil.current){base.current=len;return}
      if(!t.trim())return;
      heard.current=t;onHeard?.(t);clearTimeout(timer.current);
      timer.current=setTimeout(()=>{const text=heard.current.trim();heard.current='';base.current=len;onHeard?.('');if(text&&stRef.current==='listening')handle(text)},PAUSE_MS);
    };
    r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){notify('無法使用麥克風：請在瀏覽器允許這個網站使用麥克風');onClose()}};
    r.onend=()=>{rec.current=null;if(alive.current&&!pausedRef.current)setTimeout(startRec,60)};   // Chrome ends a session now and then: reopen quietly
    rec.current=r;try{r.start()}catch{rec.current=null;setTimeout(startRec,300)}
  }
  function stopRec(){clearTimeout(timer.current);const r=rec.current;rec.current=null;try{r?.abort()}catch{/* stopped */}}
  function togglePause(){
    pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);
    if(pausedRef.current){if(stRef.current!=='thinking')spk.current?.stop();stopRec();heard.current='';onHeard?.('');set('paused')}else{set('listening');startRec()}
  }
  function tapOrb(){if(stRef.current==='speaking'||stRef.current==='thinking')interrupt();else togglePause()}

  // ---- voices -------------------------------------------------------------------------------------------------------
  useEffect(()=>{
    api.ttsVoices().then(r=>{
      setVoices(r);
      if(!r.enabled){cloudOk.current=false;setVoice('browser')}
      else setVoice(v=>v&&(v==='browser'||r.voices.some(x=>x.id===v))?v:r.default);
    }).catch(()=>{setVoices({voices:[]});cloudOk.current=false;setVoice('browser')});
  },[]);
  function pick(id){setVoice(id);lsSet('ms.tts.voice',id);if(id!=='browser')cloudOk.current=true}
  async function preview(v){
    stopAudio();spk.current?.stop();setPrev(v.id);
    try{const t='你好，我是你的語音助理。高血壓患者平常要記得量血壓。';
      if(v.id==='browser')playBrowser(t,()=>setPrev(''));else playBuffer(await cloudBuffer(t,v.id),()=>setPrev(''))}
    catch{setPrev('');notify('無法試聽這個聲音')}
  }
  const cur=voice==='browser'?'瀏覽器內建':(voices?.voices||[]).find(v=>v.id===voice)?.name||'…';

  useEffect(()=>{
    alive.current=true;audioCtx();window.speechSynthesis.getVoices();startRec();
    const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);
    return()=>{alive.current=false;window.removeEventListener('keydown',k);onHeard?.('');stopRec();spk.current?.stop();stopAudio();try{ctx.current?.close()}catch{/* closed */}ctx.current=null};
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  const label={listening:'聆聽中…',thinking:'思考中…（點圓球可取消）',speaking:'回覆中・點圓球可打斷',paused:'已暫停・點圓球繼續'}[st]||'';
  return <div className="vb" role="group" aria-label="語音對話">
    {menu&&<div className="vb-menu" role="dialog" aria-label="選擇回覆的聲音">
      <div className="vb-menu-h">回覆的聲音</div>
      {GROUPS.map(([g,title])=>{const list=(voices?.voices||[]).filter(v=>v.group===g);return list.length?<div key={g}><div className="vb-cap">{title}</div>{list.map(v=><div key={v.id} className={'vb-row'+(voice===v.id?' on':'')}>
        <button type="button" className="vb-pick" onClick={()=>pick(v.id)}><span className="vb-ck">{voice===v.id&&<Check size={15}/>}</span><b>{v.name}</b><small>{v.gender==='female'?'女聲':'男聲'}</small></button>
        <button type="button" className="vb-play" aria-label={'試聽 '+v.name} onClick={()=>preview(v)}>{prev===v.id?'…':<Play size={13} weight="fill"/>}</button></div>)}</div>:null})}
      <div className="vb-cap">本機</div>
      <div className={'vb-row'+(voice==='browser'?' on':'')}><button type="button" className="vb-pick" onClick={()=>pick('browser')}><span className="vb-ck">{voice==='browser'&&<Check size={15}/>}</span><b>瀏覽器內建語音</b><small>音質依你的電腦</small></button>
        <button type="button" className="vb-play" aria-label="試聽瀏覽器內建語音" onClick={()=>preview({id:'browser'})}><Play size={13} weight="fill"/></button></div>
      <label className="vb-opt"><input type="checkbox" checked={barge} onChange={e=>{setBarge(e.target.checked);lsSet('ms.tts.barge',e.target.checked?'1':'0')}}/>回覆時可直接開口打斷（建議戴耳機）</label>
      {voices&&!voices.enabled&&<p className="vb-warn">管理員尚未開放語音輸入，雲端語音不可用。</p>}
    </div>}
    <button type="button" className={'vb-orb '+st} aria-label={label} title={label} onClick={tapOrb}/>
    <div className="vb-bar"><span className="vb-state" role="status">{label}</span>
      <button type="button" className="vb-voice" aria-expanded={menu} aria-label="選擇回覆的聲音" onClick={()=>setMenu(m=>!m)}><SpeakerHigh size={16}/>{cur}<CaretUp size={12}/></button>
      <button type="button" className={'vb-btn'+(paused?' off':'')} aria-label={paused?'開啟麥克風':'暫停麥克風'} title={paused?'開啟麥克風':'暫停麥克風'} onClick={togglePause}>{paused?<MicrophoneSlash size={20}/>:<Microphone size={20}/>}</button>
      <button type="button" className="vb-end" aria-label="結束語音對話" title="結束語音對話" onClick={onClose}><X size={18} weight="bold"/></button></div>
    <small className="vb-note">語音辨識經瀏覽器的語音服務；回覆的聲音由雲端合成（文字已去識別化）。</small>
  </div>;
}
