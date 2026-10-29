import React from 'react';

// The Medisense jellyfish. Two stacked copies of the same artwork, split at the bell's rim, so that
// while the model is working the bell can pulse and the tentacles can sway independently (see .swim in styles.css).
const SRC='/assets/medisense-jelly-square.png';
export function Jelly({size=88,animated=false,circle=true,className=''}){
  return <span className={`jelly${circle?' jelly-circle':''}${animated?' swim':''}${className?' '+className:''}`} style={{width:size,height:size}} aria-hidden="true">
    <span className="jelly-body"><img className="jelly-bottom" src={SRC} alt="" draggable="false"/><img className="jelly-top" src={SRC} alt="" draggable="false"/></span>
  </span>;
}

/* Opening animation for a new conversation. The artwork is one flat PNG, so the face is animated with an SVG laid over it
   (same 360x360 box): body-coloured eyelids for the blinks, drawn eyebrows over patches that hide the painted ones,
   and a patch over the painted smile that fades out at the end. Timeline: peek (half the head at the bottom of the
   circle) -> 2 blinks -> 2 eyebrow hops -> swim to the middle -> smile. Plays once; reduced-motion shows the final pose. */
const BODY='#44d497',INK='#2b2328';
const BROW_L='M173 73 Q188 63 203 67',BROW_R='M300 103 Q316 112 320 127',MOUTH_WIPE='M181 203 Q210 228 239 205';  // covers the painted smile; its dash retracts left -> right like a swoosh
export function JellyIntro({size=120,settled=false}){
  return <span className={'ji'+(settled?' settled':'')} style={{width:size,height:size}} aria-hidden="true">
    <span className="ji-fig"><span className="ji-float">
      <img src={SRC} alt="" draggable="false"/>
      <svg viewBox="0 0 360 360">
        <path d={BROW_L} stroke={BODY} strokeWidth="13" strokeLinecap="round" fill="none"/>
        <path d={BROW_R} stroke={BODY} strokeWidth="13" strokeLinecap="round" fill="none"/>
        <g className="ji-brows"><path d={BROW_L} stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none"/><path d={BROW_R} stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none"/></g>
        <path className="ji-mouth" d={MOUTH_WIPE} pathLength="1" stroke={BODY} strokeWidth="24" strokeLinecap="butt" fill="none"/>
        <ellipse className="ji-lid" cx="184.5" cy="138" rx="45" ry="49" fill={BODY}/>
        <ellipse className="ji-lid" cx="266" cy="167.5" rx="46" ry="50" fill={BODY}/>
      </svg>
    </span></span>
  </span>;
}
