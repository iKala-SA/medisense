import React from 'react';
import {PencilSimple,Flask,RocketLaunch,Check,Info} from '@phosphor-icons/react';

/* 編輯 → 沙盒 → 發布: the lifecycle of every Agent and flow, shown in the editor header. The sandbox is where a draft is tried out
   (reads run for real, writes are only simulated, usage is counted apart); 發布 puts the tested version in production. */
export function stageOf(a){
  if(a.status==='published'&&a.review?.state!=='pending')return 3;
  if(a.review?.state==='pending')return 3;
  return 2;
}
export default function Stages({a,onSandbox,onPublish,sandboxActive=false}){
  const pub=a.status==='published',pending=a.review?.state==='pending',rejected=a.review?.state==='rejected';
  const publishLabel=pending?`審核中 v${a.review.version}`:pub?`已發布 v${a.version}`:rejected?'已退回':'發布';
  return <ol className="ag-stages" aria-label="流程階段">
    <li className="done"><span className="dot"><Check size={11} weight="bold"/></span><span className="lb"><PencilSimple size={14}/>編輯</span></li>
    <li className={'link'+(sandboxActive?' on':'')}><button type="button" onClick={onSandbox} title="在沙盒用目前的草稿試跑"><span className="dot"><Flask size={11}/></span><span className="lb">沙盒</span></button></li>
    <li className={'link'+(pub||pending?' done':'')+(rejected?' warn':'')}><button type="button" onClick={onPublish} title="發布與版本"><span className="dot">{pub||pending?<Check size={11} weight="bold"/>:<RocketLaunch size={11}/>}</span><span className="lb">{publishLabel}</span></button></li>
  </ol>;
}
export function SandboxNote({compact=false}){
  return <div className={'ag-sandbox-note'+(compact?' compact':'')} role="note"><Info size={16}/><span><b>沙盒環境</b>　用目前的草稿試跑。讀取動作會真的執行；寄信、寫入資料等<b>寫入動作只會模擬</b>，不會對外發生，也不需要核准。這裡的對話與用量和正式環境分開統計。</span></div>;
}
