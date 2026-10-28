/* Keep a floating menu inside the window. Every popover / flyout in the app goes through this, so a menu is never
   cut off by the bottom or right edge: it is nudged up/left by whatever overflows (a menu taller than the window scrolls
   instead). `flip` lets a flyout switch to the other side of its parent when it runs out of room on the right. */
export const EDGE=8;
export function fitMenu(el,flip=false,minLeft=EDGE){
  if(!el)return;
  el.style.transform='';el.style.overflowY='';
  if(el.dataset.flipped){el.style.left='';el.style.right='';delete el.dataset.flipped}
  const H=window.innerHeight,W=window.innerWidth;
  let r=el.getBoundingClientRect();
  if(r.height>=H-EDGE*2){el.style.maxHeight=`${H-EDGE*2}px`;el.style.overflowY='auto';r=el.getBoundingClientRect()} // a scroll box would clip flyouts, so only when needed
  const room=el.parentElement?el.parentElement.getBoundingClientRect().left-4-r.width:-1; // space to the left of the parent, if flipped
  if(flip&&r.right>W-EDGE&&room>=minLeft){el.style.left='auto';el.style.right='calc(100% + 4px)';el.dataset.flipped='1';r=el.getBoundingClientRect()}
  const dy=r.bottom>H-EDGE?H-EDGE-r.bottom:r.top<EDGE?EDGE-r.top:0;
  const dx=r.right>W-EDGE?W-EDGE-r.right:r.left<minLeft?minLeft-r.left:0; // no room on either side: slide over the parent menu
  if(dx||dy)el.style.transform=`translate(${dx}px,${dy}px)`;
}
