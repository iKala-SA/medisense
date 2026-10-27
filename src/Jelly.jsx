import React from 'react';

// The Medisense jellyfish. Two stacked copies of the same artwork, split at the bell's rim, so that
// while the model is working the bell can pulse and the tentacles can sway independently (see .swim in styles.css).
const SRC='/assets/medisense-jelly-square.png';
export function Jelly({size=88,animated=false,circle=true,className=''}){
  return <span className={`jelly${circle?' jelly-circle':''}${animated?' swim':''}${className?' '+className:''}`} style={{width:size,height:size}} aria-hidden="true">
    <span className="jelly-body"><img className="jelly-bottom" src={SRC} alt="" draggable="false"/><img className="jelly-top" src={SRC} alt="" draggable="false"/></span>
  </span>;
}
