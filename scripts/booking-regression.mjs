// Exercises the real handlers and services. Only HTTP provider adapters are simulated.
// No .env files loaded; unknown network destinations are always rejected.
import {registerHooks,createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
registerHooks({resolve(spec,context,next){
 if(spec.startsWith('@/'))return next(pathToFileURL(resolve(root,'src',spec.slice(2)+'.ts')).href,context);
 try{return next(spec,context)}catch(error){
  if(spec.startsWith('.'))return next(new URL(spec+'.ts',context.parentURL).href,context);
  return next(pathToFileURL(createRequire(context.parentURL).resolve(spec)).href,context);
 }
},load(url,context,next){if(url.startsWith(pathToFileURL(root+'/src/').href)&&url.endsWith('.ts'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};return next(url,context)}});
for(const name of Object.keys(process.env))if(/^(SUPABASE|NEXT_PUBLIC_SUPABASE|GOOGLE_|SMTP_|ZOHO_|MAIL_)/.test(name))delete process.env[name];
Object.assign(process.env,{NODE_ENV:'test',SUPABASE_URL:'https://synthetic-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_REFRESH_TOKEN:'synthetic-refresh',MAIL_TRANSPORT:'gmail',FROM_EMAIL:'team@example.test',NOTIFY_EMAIL:'team@example.test',BOOKING_TIMEZONE:'Asia/Singapore',AVAILABLE_DAYS:'0,1,2,3,4,5,6',SLOT_DURATION_MINUTES:'30',MIN_NOTICE_MINUTES:'0'});
let mode='ok',rows=[],events=[],mail=[],calls=[];
const reset=m=>{mode=m;rows=[];events=[];mail=[];calls=[]};
globalThis.fetch=async(input,init={})=>{
 const req=input instanceof Request?input:null,url=new URL(req?.url||String(input)),method=init.method||req?.method||'GET',raw=init.body|| (req&&method!=='GET'?await req.text():'');
 const body=raw&&url.hostname!=='oauth2.googleapis.com'?JSON.parse(raw):{};calls.push({host:url.hostname,path:url.pathname,method});
 if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.send'});
 if(url.hostname==='www.googleapis.com'){
  if(url.pathname.endsWith('/freeBusy'))return mode==='google-read-failure'?Response.json({error:{message:'synthetic unavailable'}},{status:503}):Response.json({calendars:{primary:{busy:[]}}});
  if(url.pathname.endsWith('/events')){assert.equal(rows.length,1,'booking must be durable before calendar write');events.push(body);return mode==='calendar-failure'?Response.json({error:{message:'synthetic failure'}},{status:503}):Response.json({id:'synthetic-calendar-event',hangoutLink:'https://meet.google.com/abc-defg-hij',htmlLink:'https://calendar.google.com/synthetic'})}
 }
 if(url.hostname==='gmail.googleapis.com'){mail.push(body);return mode==='mail-failure'?Response.json({error:{message:'synthetic rejected'}},{status:503}):Response.json({id:'synthetic-message'})}
 if(url.hostname==='synthetic-project.supabase.co'){
  if(url.pathname.endsWith('/bookings')){
   if(method==='GET')return mode==='database-read-failure'?Response.json({message:'synthetic database unavailable',code:'XX000'},{status:503}):Response.json(rows.map(r=>({start_utc:r.start_utc})));
   if(method==='POST'){
    if(mode==='database-write-failure')return Response.json({message:'synthetic schema missing',code:'42P01'},{status:400});
    if(mode==='slot-conflict')return Response.json({message:'duplicate slot',code:'23505'},{status:409});
    const row={...body,id:'00000000-0000-4000-8000-000000000001'};rows.push(row);return Response.json(row);
   }
   if(method==='PATCH'){Object.assign(rows[0],body);return new Response(null,{status:204})}
  }
  if(['/rest/v1/booking_events','/rest/v1/website_events'].includes(url.pathname))return new Response(null,{status:201});
 }
 throw Error('BLOCKED unrecognised external adapter: '+url.origin+url.pathname);
};
const {POST}=await import('../src/app/api/book/route.ts');
const {GET}=await import('../src/app/api/availability/route.ts');
const {NextRequest}=await import('next/server.js');
const {schedulerDatabaseSettings}=await import('../src/lib/serverConfig.ts');
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const payload={clientName:'Synthetic Owner',clientEmail:'owner@example.test',goal:'Pharmacy',challenges:['Care handovers'],date,time:'23:30',visitorId:'not-a-uuid'};
const post=body=>POST(new NextRequest('http://localhost/api/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
const checks=[],failures=[];
async function check(name,fn){try{await fn();checks.push(name);console.log('PASS '+name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message)}}
await check('Scheduler project credentials are separate and mismatched JWT projects rejected',async()=>{const saved=process.env.SUPABASE_SERVICE_ROLE_KEY;try{for(const claims of [{role:'service_role',ref:'wrong-project'},{role:'anon',ref:'synthetic-project'}]){process.env.SUPABASE_SERVICE_ROLE_KEY='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';assert.throws(()=>schedulerDatabaseSettings(),/different projects|service-role/)}process.env.SUPABASE_SERVICE_ROLE_KEY='';assert.throws(()=>schedulerDatabaseSettings(),/missing/)}finally{process.env.SUPABASE_SERVICE_ROLE_KEY=saved}});
await check('Google availability failure returns 503, not invented slots',async()=>{reset('google-read-failure');const r=await GET(new NextRequest('http://localhost/api/availability?date='+date));assert.equal(r.status,503)});
await check('Database availability failure returns 503',async()=>{reset('database-read-failure');const r=await GET(new NextRequest('http://localhost/api/availability?date='+date));assert.equal(r.status,503)});
await check('Persistence failure prevents calendar and confirmation writes',async()=>{reset('database-write-failure');const r=await post(payload);assert.equal(r.status,503);assert.equal(events.length,0);assert.equal(mail.length,0)});
await check('Guest booking persists, creates Meet, records mail and midnight rollover',async()=>{reset('ok');const r=await post(payload),d=await r.json();assert.equal(r.status,200);assert.equal(d.success,true);assert.equal(d.persisted,true);assert.equal(d.emailSent,true);assert.equal(rows[0].status,'confirmed');assert.equal(rows[0].visitor_id,null);assert.equal(rows[0].client_email_status,'sent');assert.equal(rows[0].practitioner_email_status,'sent');assert.equal(events.length,1);assert.equal(mail.length,2);assert.match(events[0].end.dateTime,/T00:00:00$/);assert.ok(events[0].attendees.some(a=>a.email==='team@example.test'));assert.equal(d.meetUrl,'https://meet.google.com/abc-defg-hij')});
await check('Concurrent slot conflict cannot create another event',async()=>{reset('slot-conflict');const r=await post(payload);assert.equal(r.status,409);assert.equal(events.length,0);assert.equal(mail.length,0)});
await check('Failed email preserves a genuine calendar confirmation and link',async()=>{reset('mail-failure');const r=await post(payload),d=await r.json();assert.equal(r.status,200);assert.equal(d.emailSent,false);assert.equal(rows[0].status,'confirmed');assert.equal(rows[0].client_email_status,'failed')});
await check('Calendar failure cannot return successful confirmation',async()=>{reset('calendar-failure');const r=await post(payload),d=await r.json();assert.equal(r.status,502);assert.ok(!d.success);assert.equal(rows[0].calendar_status,'failed')});
await check('Malformed payload and invalid civil date rejected before writes',async()=>{reset('ok');for(const body of [null,[],{...payload,date:'2026-02-31'}])assert.equal((await post(body)).status,400);assert.equal(events.length,0);assert.equal(rows.length,0)});
console.log(JSON.stringify({passed:checks.length,failed:failures.length,failures,integrations:'HTTP boundaries simulated; real handlers, timezone, persistence client, calendar builder and MIME mail paths exercised; no real outbound effects.'},null,2));
if(failures.length)process.exitCode=1;
