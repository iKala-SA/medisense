import React from 'react';
import {useCharacter} from './characters';

// The Medisense character (a random one per page load, see characters.js), standing in for the old jellyfish.
// While the model is working it bobs and squishes (see .swim in styles.css).
export function Jelly({size=88,animated=false,circle=true,className=''}){
  const CHARACTER=useCharacter();
  return <span className={`jelly${circle?' jelly-circle':''}${animated?' swim':''}${className?' '+className:''}`} style={{width:size,height:size}} aria-hidden="true">
    <span className="jelly-body"><img className="jelly-top" src={CHARACTER} alt="" draggable="false"/></span>
  </span>;
}
