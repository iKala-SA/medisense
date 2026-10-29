import React,{useEffect,useRef,useState} from 'react';
import {JellyIntro} from './Jelly';
import doctor from './assets/mascot-doctor.webp';
import nurse from './assets/mascot-nurse.webp';

/* New conversation: the original opening plays untouched (the jellyfish peeks, blinks twice, its eyebrows hop twice, it swims to
   the middle and smiles). Only a click changes it: the jellyfish becomes a doctor, then a nurse (alternating), jumps out of the
   grey circle, and after 6.5 s goes back to the jellyfish. Reduced motion: no jump, the costume just appears. */
const COSTUMES=[null,doctor,nurse],NAMES=['','醫師','護理師'];
export function Mascot(){
  const [role,setRole]=useState(0),[played,setPlayed]=useState(false);
  const stage=useRef(null),next=useRef(1),back=useRef(null);
  useEffect(()=>()=>clearTimeout(back.current),[]);
  const summon=()=>{
    clearTimeout(back.current);
    const r=next.current;next.current=r===1?2:1;
    setPlayed(true);setRole(r);
    const el=stage.current;if(el){el.dataset.out='false';void el.offsetWidth;el.dataset.out='true'} // restarts the jump when clicked again
    back.current=setTimeout(()=>setRole(0),6500);
  };
  const key=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();summon()}};
  return <div className="mcw" ref={stage} data-out={role>0} role="button" tabIndex={0} onClick={summon} onKeyDown={key}
    aria-label={`點一下，召喚${NAMES[next.current]}造型`} title="點一下">
    <span className="mcw-circle" aria-hidden="true"/>
    {role===0
      ?<JellyIntro size="var(--sz)" settled={played}/>
      :<span className="mcw-fig" aria-hidden="true"><span className="mcw-sprite" style={{backgroundImage:`url(${COSTUMES[role]})`}}/></span>}
  </div>;
}
