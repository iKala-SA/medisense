/* Images headed for the chat. Whatever the browser hands over (screenshot paste, WebP, GIF, a 12 MP photo) is turned into a
   PNG / JPEG of at most MAX_SIDE px before upload: the server only accepts PNG, JPEG and BMP up to 4 MB. */
const MAX_SIDE=1600,LIMIT=3_800_000;
export const isImage=f=>!!f&&/^image\//.test(f.type||'');
const toBlob=(c,type,q)=>new Promise(res=>c.toBlob(res,type,q));
export async function prepareImage(file){
  const bmp=await createImageBitmap(file);
  const k=Math.min(1,MAX_SIDE/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),h=Math.max(1,Math.round(bmp.height*k));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);g.drawImage(bmp,0,0,w,h);bmp.close?.();
  const jpeg=/jpe?g/.test(file.type);
  let blob=await toBlob(c,jpeg?'image/jpeg':'image/png',0.9);
  if(blob&&blob.size>LIMIT)blob=await toBlob(c,'image/jpeg',0.8); // a big screenshot: JPEG is much smaller
  if(!blob||blob.size>LIMIT)throw new Error('圖片太大，請縮小後再試');
  const ext=blob.type==='image/jpeg'?'jpg':'png',base=(file.name||'').replace(/\.[^.]+$/,'')||'image';
  return new File([blob],`${base}.${ext}`,{type:blob.type});
}
