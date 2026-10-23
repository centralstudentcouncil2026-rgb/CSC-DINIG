import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../server/app.js';
import {database} from '../server/database.js';
import {attachmentsInput,cookie} from '../server/security.js';
let pg,server,base,tx;
const admin=randomUUID(),handler=randomUUID(),reviewer=randomUUID(),independent=randomUUID(),outsider=randomUUID();
// Real PostgreSQL semantics in memory, with a serial connection adapter.
let queue=Promise.resolve();
const pool={async connect(){let release;const next=new Promise(resolve=>release=resolve),previous=queue;queue=next;await previous;return {query:(sql,args)=>pg.query(sql,args),release};}};
const config={origin:'http://127.0.0.1:3000',secure:false,rateSecret:'a'.repeat(64),emergencyGuidance:'',responseGuidance:'',retentionDays:365};
async function browser(){const jar=new Map();let csrf;return {async call(path,body){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{Origin:config.origin,'Content-Type':'application/json','X-CSRF-Token':csrf||''})},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}const type=response.headers.get('content-type')||'',data=type.includes('json')?await response.json():await response.text();if(data.csrf)csrf=data.csrf;return {status:response.status,data,headers:response.headers};},jar};}
const concern=(key=randomUUID())=>({submissionKey:key,codeName:'Same code name',category:'Academic',subject:'A concern',details:'Please review the campus concern.',privacy:true,attachments:[]});
async function account(id){const client=await browser();await client.call('/session');const result=await client.call('/staff/login',{email:id,password:'test-only-provider-adapter'});assert.equal(result.status,200);return client;}
await (async()=>{
 pg=new PGlite();await pg.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
 await pg.exec(await fs.readFile(new URL('../migrations/001_dinig.sql',import.meta.url),'utf8'));
 for(const id of [admin,handler,reviewer,independent,outsider])await pg.query('INSERT INTO auth.users VALUES($1)',[id]);
 for(const [id,role,sensitive]of [[admin,'administrator',true],[handler,'handler',false],[reviewer,'restricted_reviewer',true],[independent,'restricted_reviewer',true]])await pg.query('INSERT INTO dinig.staff_profiles(user_id,display_name,role,sensitive_access) VALUES($1,$2,$3,$4)',[id,role,role,sensitive]);
 tx=database(pool);server=http.createServer(createApp({pool,config,authenticate:async email=>email}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
})();
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await pg.close();});
test('submission, duplicate code names, idempotency and secret hashing',async()=>{
 const client=await browser();await client.call('/session');const body=concern(),a=await client.call('/reports',body),b=await client.call('/reports',concern());
 assert.equal(a.status,201);assert.equal(b.status,201);assert.notEqual(a.data.trackingCode,b.data.trackingCode);assert.match(a.data.trackingCode,/^[\w-]{32}$/);
 assert.equal((await client.call('/reports',body)).status,409);
 const rows=await pg.query('SELECT * FROM dinig.report_access_credentials');assert.equal(rows.rows.length,2);assert.equal(rows.rows[0].code_hash.length,64);assert(!JSON.stringify(rows.rows).includes(a.data.trackingCode));
 assert.equal((await client.call('/track',{code:a.data.reference})).status,401);
 assert.equal((await client.call('/track',{code:'Same code name'})).status,401);
 assert.equal((await client.call('/track',{code:a.data.trackingCode})).status,200);
 const detail=await client.call('/student/report');assert.equal(detail.data.report.reference,a.data.reference);
 assert.equal(detail.headers.get('cache-control'),'no-store, private');assert(!JSON.stringify(detail.data).includes('code_hash'));
});
test('report-bound sessions, ID tampering and private notes cannot disclose other data',async()=>{
 const student=await browser();await student.call('/session');
 // Bypass per-IP submission test quotas only by clearing test infrastructure.
 await pg.query('DELETE FROM dinig.rate_limits');
 const a=(await student.call('/reports',concern())).data;await student.call('/track',{code:a.trackingCode});
 const id=(await student.call('/student/report')).data.report.id;const staff=await account(admin);
 assert.equal((await staff.call(`/staff/reports/${id}/message`,{body:'SECRET internal note',internal:true})).status,200);
 assert.equal((await staff.call(`/staff/reports/${id}/message`,{body:'Public reply'})).status,200);
 const output=await student.call('/student/report');assert(!JSON.stringify(output.data).includes('SECRET'));assert(output.data.messages.some(m=>m.body==='Public reply'));
 const other=(await pg.query('SELECT id FROM dinig.reports WHERE id<>$1 LIMIT 1',[id])).rows[0].id;
 assert.equal((await student.call('/student/report?report='+other)).data.report.id,id);
 assert.equal((await student.call(`/staff/reports/${other}`)).status,401);
 assert.equal((await student.call(`/student/reports/${other}`)).status,404);
 await tx({reportId:id},async db=>{
  assert.equal((await db.query('SELECT * FROM dinig.reports WHERE id=$1',[other])).rows.length,0);
  assert.equal((await db.query('SELECT * FROM dinig.report_messages WHERE internal')).rows.length,0);
 });
 assert.equal((await student.call('/student/message',{reportId:other,body:'Follow up',internal:true})).status,200);
 assert.equal((await staff.call(`/staff/reports/${id}`)).data.messages.at(-1).internal,false);
});
test('staff membership, explicit assignments, restricted access and private attachments',async()=>{
 await pg.query('DELETE FROM dinig.rate_limits');const student=await browser();await student.call('/session');
 const rejected=await student.call('/staff/login',{email:outsider,password:'anything'});assert.equal(rejected.status,401);
 await pg.query('UPDATE dinig.routing_rules SET restricted=true,reviewer_id=$1 WHERE category=\'Safety and Welfare\'',[reviewer]);
 const body={...concern(),category:'Safety and Welfare',attachments:[{name:'proof.png',data:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')}]};
 const submitted=await student.call('/reports',body);assert.equal(submitted.status,201);await student.call('/track',{code:submitted.data.trackingCode});
 const detail=(await student.call('/student/report')).data,id=detail.report.id,file=detail.attachments[0].id;
 const adminClient=await account(admin),handlerClient=await account(handler),reviewerClient=await account(reviewer);
 assert.equal((await adminClient.call(`/staff/reports/${id}`)).status,404);
 assert.equal((await handlerClient.call(`/staff/reports/${id}`)).status,404);
 assert.equal((await handlerClient.call(`/staff/attachments/${file}`)).status,404);
 assert.equal((await reviewerClient.call(`/staff/reports/${id}`)).status,200);
 assert.equal((await student.call(`/student/attachments/${file}`)).status,200);
 const second=await browser();await second.call('/session');const secondSubmission=(await second.call('/reports',concern())).data;await second.call('/track',{code:secondSubmission.trackingCode});assert.equal((await second.call(`/student/attachments/${file}`)).status,404);
 assert.equal((await reviewerClient.call(`/staff/reports/${id}/action`,{action:'assign',staffId:handler,reason:'Try assigning'})).status,403);
});
test('complete assigned workflow, resolution, independent review, and conflict routing',async()=>{
 await pg.query('DELETE FROM dinig.rate_limits');const student=await browser();await student.call('/session');const submitted=(await student.call('/reports',concern())).data;await student.call('/track',{code:submitted.trackingCode});const id=(await student.call('/student/report')).data.report.id;
 const a=await account(admin),h=await account(handler);
 assert.equal((await h.call(`/staff/reports/${id}`)).status,404);
 assert.equal((await a.call(`/staff/reports/${id}/action`,{action:'assign',staffId:handler,reason:'Assigned for response'})).status,200);
 assert.equal((await h.call(`/staff/reports/${id}`)).status,200);
 for(const status of ['Under Review','Awaiting Student Response','In Progress','Resolved'])assert.equal((await h.call(`/staff/reports/${id}/action`,{action:'status',status,reason:'Visible explanation for '+status})).status,200);
 assert.equal((await student.call('/student/action',{kind:'review_request',body:'Please reconsider this unresolved issue.'})).status,200);
 const notified=(await pg.query("SELECT staff_id FROM dinig.notifications WHERE report_id=$1 AND kind='further_review'",[id])).rows[0].staff_id;
 assert.notEqual(notified,handler);const r=await account(notified);
 assert.equal((await h.call(`/staff/reports/${id}/action`,{action:'status',status:'Under Review',reason:'Attempt review'})).status,403);
 assert.equal((await r.call(`/staff/reports/${id}/action`,{action:'status',status:'Under Review',reason:'Independent review accepted'})).status,200);
 assert.equal((await r.call(`/staff/reports/${id}/action`,{action:'status',status:'Resolved',reason:'Updated resolution'})).status,200);
 assert.equal((await student.call('/student/action',{kind:'confirmed',body:''})).status,200);
 assert.equal((await student.call('/student/report')).data.report.status,'Closed');
 assert.equal((await a.call(`/staff/reports/${id}/action`,{action:'restrict',reviewerId:independent,conflictStaff:[handler],reason:'Handler involved in case'})).status,200);
 assert.equal((await h.call(`/staff/reports/${id}`)).status,404);
 const i=await account(independent);assert.equal((await i.call(`/staff/reports/${id}`)).status,200);
});
test('CSRF, throttling, expiry, validation, and unsafe uploads',async()=>{
 await pg.query('DELETE FROM dinig.rate_limits');
 const client=await browser();await client.call('/session');
 const response=await fetch(base+'/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(concern())});assert.equal(response.status,403);
 assert.equal((await client.call('/reports',{...concern(),privacy:false})).status,400);
 assert.throws(()=>attachmentsInput([{name:'payload.html',data:Buffer.from('<script>alert(1)</script>').toString('base64')}]));
 assert.throws(()=>attachmentsInput([{name:'payload.png',data:Buffer.from('%PDF-test').toString('base64')}]));
 for(let i=0;i<10;i++)assert.equal((await client.call('/track',{code:'wrong'})).status,401);
 assert.equal((await client.call('/track',{code:'wrong'})).status,429);
 const staff=await account(admin);await pg.query("UPDATE dinig.sessions SET touched_at=now()-interval '31 minutes' WHERE staff_id=$1",[admin]);assert.equal((await staff.call('/staff/options')).status,401);
 const page=await fetch(base+'/');assert(page.headers.get('content-security-policy').includes("script-src 'self'"));
});
test('administration settings are permission-checked and audit metadata only',async()=>{
 await pg.query('DELETE FROM dinig.rate_limits');const a=await account(admin),h=await account(handler);
 assert.equal((await h.call('/staff/settings',{type:'office',name:'Invented'})).status,403);
 assert.equal((await a.call('/staff/settings',{type:'office',name:'Test approved office'})).status,200);
 assert.equal((await a.call('/staff/settings',{type:'routing',category:'Academic',reviewerId:handler,targetHours:24,restricted:false})).status,200);
 const events=(await pg.query('SELECT action FROM dinig.audit_events WHERE report_id IS NULL')).rows;assert(events.some(e=>e.action==='settings_routing'));
});
test('approved referrals remain unresolved until an explicit resolution',async()=>{
 await pg.query('DELETE FROM dinig.rate_limits');const student=await browser();await student.call('/session');const submitted=(await student.call('/reports',concern())).data;await student.call('/track',{code:submitted.trackingCode});const id=(await student.call('/student/report')).data.report.id,a=await account(admin);
 const office=(await pg.query('SELECT id FROM dinig.approved_offices LIMIT 1')).rows[0].id;
 assert.equal((await a.call(`/staff/reports/${id}/action`,{action:'refer',officeId:randomUUID(),reason:'A plan',publicExplanation:'An explanation'})).status,400);
 assert.equal((await a.call(`/staff/reports/${id}/action`,{action:'refer',officeId:office,reason:'Follow up after office review',publicExplanation:'Your concern was referred for further action.'})).status,200);
 let view=(await a.call(`/staff/reports/${id}`)).data;assert.equal(view.report.status,'Referred');
 assert.equal((await a.call(`/staff/reports/${id}/action`,{action:'referral_outcome',referralId:view.referrals[0].id,reason:'Office follow-up complete'})).status,200);
 assert.equal((await student.call('/student/report')).data.report.status,'Referred');
});
test('involved staff are excluded automatically and client database roles have no grants',async()=>{
 await pg.query('DELETE FROM dinig.rate_limits');const student=await browser();const setup=await student.call('/session');
 const publicId=(await pg.query('SELECT public_id FROM dinig.staff_profiles WHERE user_id=$1',[handler])).rows[0].public_id;
 assert(!JSON.stringify(setup.data.routingStaff).includes(handler));
 const submitted=await student.call('/reports',{...concern(),involvedStaff:publicId});assert.equal(submitted.status,201);await student.call('/track',{code:submitted.data.trackingCode});const id=(await student.call('/student/report')).data.report.id;
 const h=await account(handler);assert.equal((await h.call(`/staff/reports/${id}`)).status,404);
 const report=(await pg.query('SELECT sensitive,conflict_staff FROM dinig.reports WHERE id=$1',[id])).rows[0];assert(report.sensitive);assert(report.conflict_staff.includes(handler));
 await pg.exec('CREATE ROLE anonymous_client NOLOGIN; SET ROLE anonymous_client;');
 await assert.rejects(pg.query('SELECT * FROM dinig.reports'),e=>e.code==='42501');await pg.exec('RESET ROLE;');
 const secureCookie=cookie({secure:true},'student','secret',3600);for(const flag of ['__Host-dinig-student','Secure','HttpOnly','SameSite=Strict','Path=/'])assert(secureCookie.includes(flag));
});
test('deployment readiness requires both the database and an enabled administrator',async()=>{
 assert.equal((await fetch(base+'/ready')).status,200);
 await pg.query('UPDATE dinig.staff_profiles SET enabled=false WHERE user_id=$1',[admin]);
 try{const response=await fetch(base+'/ready');assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false});}
 finally{await pg.query('UPDATE dinig.staff_profiles SET enabled=true WHERE user_id=$1',[admin]);}
});
