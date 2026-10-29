// Plain data copied from tcvgh-agent-platform/mvp/frontend/src/types.ts and pages/Audit.tsx. Keep in sync with backend schemas.py.
export const DEPARTMENTS=['內科部','外科部','急診醫學部','心臟血管中心','神經醫學中心','新陳代謝科','放射線部','護理部','藥劑部','感染管制中心','臨床試驗與轉譯研究中心','智慧醫療組 (IT)'];

export const ROLES=[
  {id:'admin',label:'系統管理員',en:'Admin',desc:'可編輯與發布全院任何 Agent、核可發布申請，並檢視監控成本、資安稽核軌跡，管理同仁帳號與權限。',can:['發布核可','監控與成本','資安稽核','帳號管理']},
  {id:'builder',label:'Agent 建置者',en:'Builder',desc:'可在 Agent Studio 建立自己的 Agent、於沙盒測試並申請全院發布，新增連接器與上傳院內知識文件。',can:['Agent Studio','申請發布','連接器','知識庫上傳']},
  {id:'user',label:'一般使用者',en:'User',desc:'只能在 Agent Hub 與全院已發布的 Agent 對話，看不到建置、連接器與知識庫功能。新登入的同仁預設為此角色。',can:['已發布 Agent 對話']}
];
export const ROLE_LABEL={admin:'系統管理員',builder:'Agent 建置者',user:'一般使用者'};

export const STATUSES=[
  {id:'active',label:'正常啟用',desc:'可用院內 Google 帳號登入平台，依角色使用 Agent Hub、建置與管理功能。'},
  {id:'suspended',label:'暫停使用',desc:'立即阻擋平台 API（其他伺服器執行個體最多 30 秒內生效），並停用 Google 登入、撤銷登入權杖。Agent、連接器與知識文件保留不動，可隨時恢復。'}
];

export const ACTION_LABEL={
  'agent.create':'建立 Agent','agent.update':'更新草稿','agent.publish':'發布版本','agent.unpublish':'下架','agent.delete':'刪除 Agent',
  'agent.publish_request':'申請全院發布','agent.publish_withdraw':'撤回發布申請','agent.publish_approve':'核可發布','agent.publish_reject':'退回發布申請',
  'agent.run':'推論呼叫','agent.approve':'核准外部動作','agent.reject':'駁回外部動作',
  'knowledge.upload':'上傳知識文件','knowledge.delete':'移除知識文件','knowledge.error':'知識索引失敗','knowledge.reindex':'去識別化重建索引',
  'connector.create':'新增連接器','connector.update':'更新連接器設定','connector.delete':'刪除連接器','connector.test':'連線測試','connector.invoke':'連接器調用',
  'monitoring.export':'匯出成本報表','audit.export':'匯出稽核報表','users.export':'匯出帳號清冊',
  'user.first_login':'首次登入','user.preregister':'預先登錄帳號','user.preregister_cancel':'取消預先登錄','user.role':'變更角色',
  'user.suspend':'暫停帳號','user.reactivate':'恢復帳號','user.update':'更新帳號資料'
};
export const AUDIT_CATEGORIES={
  inference:{label:'Agent 推論',color:'#239660'},
  connector:{label:'連接器調用',color:'#2a8f9c'},
  build:{label:'建置與知識',color:'#c27c1e'},
  access:{label:'帳號、金鑰與匯出',color:'#b3261e'},
  other:{label:'其他',color:'#9a98a4'}
};

export const fmtInt=n=>Number(n||0).toLocaleString('en-US');
export const fmtDateTime=iso=>iso?new Date(iso).toLocaleString('zh-TW',{hour12:false}):'—';
export const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const daysAgo=n=>ymd(new Date(Date.now()-n*864e5));
export const errText=e=>String(e?.message||e).replace(/^Error:\s*/,'');
