// Builds src/live/providerIcons.json: service id -> bundled brand logo (Iconify data).
// Inputs are devDependencies only (@iconify-json/logos, @iconify-json/simple-icons, simple-icons) plus
// scripts/provider-names.snapshot.json (a slim copy of the gateway catalog), so the build is offline and reproducible.
// Precision beats coverage: only exact (normalized) brand-name matches, hand overrides, and an exclusion list.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
const require=createRequire(import.meta.url);
const logos=require('@iconify-json/logos/icons.json');
const simple=require('@iconify-json/simple-icons/icons.json');
const si=await import('simple-icons');
const hexBySlug={};for(const v of Object.values(si))if(v&&v.slug)hexBySlug[v.slug]={hex:v.hex,title:v.title};
const snapshot=JSON.parse(readFileSync(new URL('./provider-names.snapshot.json',import.meta.url)));

const norm=s=>String(s).toLowerCase().normalize('NFKD').replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const BAD=/(wordmark|logo|-ar|dark|text|-light|vertical|horizontal|-black|-white|-mono)/;
const MAXBODY=4000
const skipped=[];; // skip huge illustrations; they don't read at 24px anyway

/* index: normalized brand -> logos key (prefer "-icon", then plain, then newest dated) */
const L={};
for(const k of Object.keys(logos.icons)){
  if(BAD.test(k))continue;
  const icon=k.endsWith('-icon');
  const base=norm(icon?k.slice(0,-5):k);
  const rank=icon?0:/-\d{4}$/.test(k)?2:1;
  if(!L[base]||rank<L[base].rank)L[base]={key:k,rank};
}
const S={};
for(const k of Object.keys(simple.icons)){S[norm(k)]=k;const t=hexBySlug[k]?.title;if(t&&!S[norm(t)])S[norm(t)]=k}

const logosIcon=k=>{const i=logos.icons[k];if(!i)throw new Error('missing logos:'+k);return {body:i.body,width:i.width||logos.width,height:i.height||logos.height,set:'logos'}};
const HEX={googledocs:'4285F4',googlesheets:'34A853',googleslides:'FBBC04',googleforms:'7248B9',googlechat:'00AC47',googletasks:'4285F4',googlebigquery:'669DF6',microsoftoutlook:'0078D4',openai:'10A37F',canva:'00C4CC',walmart:'0071CE',microsoftexcel:'217346'};
const nohex=[];
const simpleIcon=k=>{
  const i=simple.icons[k];if(!i)throw new Error('missing simple-icons:'+k);
  let hex=HEX[k]||hexBySlug[k]?.hex;if(!hex){nohex.push(k);hex='333333'}
  const n=parseInt(hex,16),lum=((n>>16)*0.299+((n>>8)&255)*0.587+(n&255)*0.114)/255;
  if(lum>0.88)hex='333333';
  return {body:`<g fill="#${hex}">${i.body.replace(/ fill="currentColor"/g,'')}</g>`,width:i.width||simple.width||24,height:i.height||simple.height||24,set:'simple-icons'};
};
const lg=k=>()=>logosIcon(k), sm=k=>()=>simpleIcon(k);

/* Hand-picked mappings for services that matter here (service id -> icon). */
const OVERRIDES={
  googlecalendar:lg('google-calendar'),gmail:lg('google-gmail'),googledrive:lg('google-drive'),
  googlesheets:sm('googlesheets'),googledocs:sm('googledocs'),googleslides:sm('googleslides'),googleforms:sm('googleforms'),
  googlemeet:lg('google-meet'),googlephotos:lg('google-photos'),googlechat:sm('googlechat'),googletasks:sm('googletasks'),
  googleads:lg('google-ads'),google_analytics:lg('google-analytics'),google_maps:lg('google-maps'),
  google_search_console:lg('google-search-console'),google_bigquery:sm('googlebigquery'),
  outlook:sm('microsoftoutlook'),outlook_calendar:sm('microsoftoutlook'),one_drive:lg('microsoft-onedrive'),
  microsoft_teams:lg('microsoft-teams'),microsoft_teams_bot:lg('microsoft-teams'),
  slack:lg('slack-icon'),slackbot:lg('slack-icon'),notion:lg('notion-icon'),notion_mcp:lg('notion-icon'),
  github:lg('github-icon'),gitlab:lg('gitlab-icon'),salesforce:lg('salesforce'),hubspot:lg('hubspot'),jira:lg('jira'),
  confluence:lg('confluence'),zoom:lg('zoom-icon'),dropbox:lg('dropbox'),dropbox_sign:lg('dropbox'),box:sm('box'),
  asana:lg('asana-icon'),trello:lg('trello'),linear:lg('linear-icon'),linear_mcp:lg('linear-icon'),airtable:lg('airtable'),
  zendesk:lg('zendesk'),stripe:lg('stripe'),twilio:lg('twilio-icon'),shopify:lg('shopify'),mailchimp:lg('mailchimp-freddie'),
  intercom:lg('intercom'),figma:lg('figma'),discord:lg('discord-icon'),discordbot:lg('discord-icon'),telegram:lg('telegram'),
  openai:sm('openai'),anthropic:sm('anthropic'),anthropic_admin:sm('anthropic'),gemini:lg('google-gemini'),
  instagram:lg('instagram-icon'),linkedin:lg('linkedin-icon'),whatsapp:lg('whatsapp-icon'),youtube:lg('youtube-icon'),
  twitter:sm('x'),paypal:lg('paypal'),clickup:lg('clickup-icon'),clickup_mcp:lg('clickup-icon'),
  calendly:sm('calendly'),datadog:lg('datadog'),okta:lg('okta-icon'),pagerduty:lg('pagerduty-icon'),sentry:lg('sentry-icon'),
  supabase:lg('supabase-icon'),quickbooks:sm('quickbooks'),xero:sm('xero'),
  /* sub-products / regional variants share the parent brand's mark */
  aliyun_ack:sm('alibabacloud'),aliyun_oss:sm('alibabacloud'),aliyun_sls:sm('alibabacloud'),aliyun_sts:sm('alibabacloud'),
  baidu_maps:sm('baidu'),baidu_netdisk:sm('baidu'),qianfan:sm('baidu'),bing_webmaster:lg('bing'),
  cloudflare_browser_rendering:lg('cloudflare-icon'),cloudflare_dns:lg('cloudflare-icon'),cloudflare_email_routing:lg('cloudflare-icon'),
  cloudflare_r2:lg('cloudflare-icon'),cloudflare_worker:lg('cloudflare-workers-icon'),
  apple_ads:lg('apple'),apple_maps:lg('apple'),apple_notary:lg('apple'),appledb:lg('apple'),app_store_server:sm('appstore'),itunes_search:sm('itunes'),
  canva_cn:sm('canva'),cisco_meraki:sm('cisco'),docker_hub:lg('docker-icon'),contentful_graphql:lg('contentful'),
  contentstack_content_delivery:sm('contentstack'),contentstack_content_management:sm('contentstack'),
  shopify_partner:lg('shopify'),shopify_storefront:lg('shopify'),
  blaze_meter_functional:sm('blazemeter'),blaze_meter_performance:sm('blazemeter'),blaze_meter_service_virtualization:sm('blazemeter'),
  huggingface:sm('huggingface'),jina_ai:lg('jina'),snyk:lg('snyk'),splunk_http_event_collector:lg('splunk'),
  tiktok_business:lg('tiktok-icon'),tiktok_business_mcp:lg('tiktok-icon'),upstash_redis:lg('upstash-icon'),
  walmart_marketplace:sm('walmart'),weixin_official_account:sm('wechat'),weixin_store:sm('wechat'),
  mongo_db_atlas_administration:lg('mongodb-icon'),mcdonalds_cn:sm('mcdonalds'),mcdonalds_cn_mcp:sm('mcdonalds'),
  monica_crm:sm('monica'),onlyoffice_docspace:sm('onlyoffice'),retell_ai:lg('retell-icon'),hackerrank_work:sm('hackerrank'),
  xiaohongshu_store:sm('xiaohongshu'),solarwinds_service_desk:lg('solarwinds'),
  keeper_scim:sm('keeper'),auth0_management:lg('auth0-icon'),swaggerhub:lg('swagger'),google_address_validation:lg('google-icon'),
  brave_search:lg('brave'),front:lg('frontapp'),
  excel:sm('microsoftexcel'),algolia:lg('algolia'),pipedrive:lg('pipedrive'),postman:lg('postman-icon'),grafana:lg('grafana'),
  one_password:sm('1password'),one_password_events:sm('1password'),
};
/* Names that collide with an unrelated brand. Never auto-match these. */
const EXCLUDE=new Set();
const EXTRA_EXCLUDE=JSON.parse(readFileSync(new URL('./provider-icons.exclude.json',import.meta.url)));
for(const s of EXTRA_EXCLUDE)EXCLUDE.add(s);

const SUFFIX=/(eventsapi|events|api|apis|bot|cloud|mcp|admin|docs|control|webhooks|sdk|oauth|platform|forteams|teams|online|connect|v\d+|service|services|enterprise)$/;
const variants=(svc,name)=>{
  const out=[];const add=s=>{if(s&&s.length>=3&&!out.includes(s))out.push(s)};
  for(const base of [norm(svc),norm(name)]){add(base);let b=base;for(let i=0;i<2;i++){const m=b.match(SUFFIX);if(!m||b.length-m[0].length<4)break;b=b.slice(0,-m[0].length);add(b)}}
  return out;
};
const missing=[];
for(const [svc,f] of Object.entries(OVERRIDES)){try{f()}catch(e){missing.push(svc+': '+e.message)}}
if(missing.length){console.error('Bad overrides:\n'+missing.join('\n'));process.exit(1)}
const result={},report=[];
for(const {service,name} of snapshot){
  if(EXCLUDE.has(service))continue;
  let icon=null,how='';
  if(OVERRIDES[service]){icon=OVERRIDES[service]();how='override'}
  else for(const v of variants(service,name)){
    if(L[v]){icon=logosIcon(L[v].key);how='logos:'+L[v].key;break}
    if(S[v]){icon=simpleIcon(S[v]);how='simple:'+S[v];break}
  }
  if(!icon)continue;
  if(how!=='override'&&icon.body.length>MAXBODY){skipped.push(name);continue}
  result[service]=icon;report.push(`${service}\t${name}\t${how}`);
}
writeFileSync(new URL('../src/live/providerIcons.json',import.meta.url),JSON.stringify(result));
writeFileSync(new URL('./provider-icons.report.tsv',import.meta.url),report.join('\n')+'\n');
const raw=readFileSync(new URL('../src/live/providerIcons.json',import.meta.url));
const by={};Object.values(result).forEach(i=>by[i.set]=(by[i.set]||0)+1);
if(nohex.length)console.log('simple-icons without official hex (rendered #333):',[...new Set(nohex)].join(' '));
console.log('skipped (icon larger than '+MAXBODY+' chars):',skipped.length,skipped.join(', '));
console.log(`matched ${Object.keys(result).length}/${snapshot.length}`,by,`raw ${(raw.length/1024).toFixed(0)}KB gzip ${(gzipSync(raw).length/1024).toFixed(0)}KB`);
