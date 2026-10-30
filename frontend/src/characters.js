import {useSyncExternalStore} from 'react';

// The Medisense characters. One is picked at random when the page loads, and a different one every time a new chat starts.
const files=import.meta.glob('./assets/characters/*.webp',{eager:true,import:'default'});
export const CHARACTERS=Object.values(files);
let current=CHARACTERS[Math.floor(Math.random()*CHARACTERS.length)];
const listeners=new Set();
export function shuffleCharacter(){
  const others=CHARACTERS.filter(c=>c!==current);
  if(!others.length)return;
  current=others[Math.floor(Math.random()*others.length)];
  listeners.forEach(l=>l());
}
export const useCharacter=()=>useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb)},()=>current);
