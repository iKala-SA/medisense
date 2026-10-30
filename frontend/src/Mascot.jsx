import React,{useRef} from 'react';
import {useCharacter} from './characters';

/* New conversation: today's character pops in, then bobs. Clicking it makes it hop again. */
export function Mascot(){
  const CHARACTER=useCharacter();
  const fig=useRef(null);
  const hop=()=>{const el=fig.current;if(el){el.dataset.hop='false';void el.offsetWidth;el.dataset.hop='true'}};
  const key=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();hop()}};
  return <div className="mcw" role="button" tabIndex={0} onClick={hop} onKeyDown={key} aria-label="點一下，打個招呼" title="點一下">
    <span className="mcw-fig" ref={fig} aria-hidden="true"><img src={CHARACTER} alt="" draggable="false"/></span>
  </div>;
}
