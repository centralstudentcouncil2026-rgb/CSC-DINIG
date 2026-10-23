import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createHarness} from './sheets-harness.js';
const h=createHarness(),adminId=h.rows('Staff')[0].id;
const login=h.request('/staff/login',{email:'aupcscdinig@aup.edu.ph',password:'Test-only initial password 2026!'});assert(login.ok);const admin={staffToken:login.data.staffToken};
const concern=()=>({submissionKey:crypto.randomUUID(),codeName:'Duplicate nickname',category:'Academic',subject:'Campus concern',details:'Please review this issue.',privacy:true});
let first,second,student,id;
test('Sheet setup stores server-keyed SHA-256 hashes and removes the initial plaintext property',()=>{
 const staff=h.rows('Staff')[0];assert.equal(staff.password_scheme,'hmac-sha256-v1');assert.equal(staff.password_iterations,0);assert.equal(staff.password_hash,crypto.createHmac('sha256',h.props.get('TOKEN_SECRET')).update('DINIG|password|v1|'+JSON.stringify([staff.password_salt,'Test-only initial password 2026!'])).digest('hex'));assert.equal(h.props.has('ADMIN_PASSWORD'),false);assert(!JSON.stringify(h.rows('Staff')).includes('Test-only initial password'));
 assert.equal(h.request('/staff/login',{email:'not-authorized@example.invalid',password:'bad-password'}).code,'UNAUTHORIZED');
 assert(!JSON.stringify(h.request('/staff/options',{},admin)).includes('password_hash'));
 const originalHash=staff.password_hash;
 h.context.setup();
 assert.equal(h.rows('Staff').length,1);
 assert.equal(h.rows('Staff')[0].password_hash,originalHash);
 assert.equal(h.rows('Routing').length,7);
});
test('anonymous submission allows duplicate nicknames and stores one-way tracking hashes',()=>{
 const body=concern();first=h.request('/reports',body);second=h.request('/reports',concern());assert(first.ok);assert(second.ok);assert.match(first.data.trackingCode,/^[\w-]{43}$/);assert.notEqual(first.data.trackingCode,second.data.trackingCode);assert.equal(h.request('/reports',body).code,'DUPLICATE');
 assert(!JSON.stringify(h.rows('Credentials')).includes(first.data.trackingCode));assert.equal(h.request('/track',{code:first.data.reference}).code,'UNAUTHORIZED');assert.equal(h.request('/track',{code:'Duplicate nickname'}).code,'UNAUTHORIZED');
 const tracked=h.request('/track',{code:first.data.trackingCode});assert(tracked.ok);student={studentToken:tracked.data.studentToken};id=h.request('/student/report',{},student).data.report.id;
});
test('report scope, original content and internal notes resist ID/role tampering',()=>{
 assert(h.request('/staff/reports/'+id+'/message',{body:'Private SECRET note',internal:true},admin).ok);
 assert(h.request('/staff/reports/'+id+'/message',{body:'Public council reply'},admin).ok);
 const view=h.request('/student/report',{id:'another-report'},student);assert(view.ok);assert.equal(view.data.report.id,id);assert(!JSON.stringify(view).includes('SECRET'));assert(view.data.messages.some(m=>m.body==='Public council reply'));assert(!('priority' in view.data.report));
 assert.equal(h.request('/staff/reports/'+id,{},student).code,'UNAUTHORIZED');
 assert(h.request('/student/message',{body:'Correction as a follow-up',reportId:'another-report',internal:true},student).ok);
 assert.equal(h.rows('Messages').at(-1).internal,false);assert.equal(h.rows('Reports').find(r=>r.id===id).details,'Please review this issue.');
});
let handler,reviewer,reviewerTokens;
test('Sheet staff accounts have server-enforced assignment and restricted case rules',()=>{
 for(const[email,name,role,sensitiveAccess]of [['handler@example.invalid','Handler','handler',false],['reviewer@example.invalid','Reviewer','restricted_reviewer',true]])assert(h.request('/staff/settings',{type:'staff',email,name,role,sensitiveAccess,enabled:true,password:'A separate test password 2026!'},admin).ok);
 handler=h.rows('Staff').find(s=>s.email==='handler@example.invalid');reviewer=h.rows('Staff').find(s=>s.email==='reviewer@example.invalid');
 const handlerTokens={staffToken:h.request('/staff/login',{email:handler.email,password:'A separate test password 2026!'}).data.staffToken};reviewerTokens={staffToken:h.request('/staff/login',{email:reviewer.email,password:'A separate test password 2026!'}).data.staffToken};
 assert.equal(h.request('/staff/reports/'+id,{},handlerTokens).code,'NOT_FOUND');
 assert(h.request('/staff/reports/'+id+'/action',{action:'assign',staffId:handler.user_id,reason:'Assigned'},admin).ok);assert(h.request('/staff/reports/'+id,{},handlerTokens).ok);
 assert.equal(h.request('/staff/settings',{type:'office',name:'Unauthorized'},handlerTokens).code,'FORBIDDEN');
 const body={...concern(),involvedStaff:handler.public_id},submitted=h.request('/reports',body);assert(submitted.ok);const token=h.request('/track',{code:submitted.data.trackingCode}).data.studentToken,restricted=h.request('/student/report',{}, {studentToken:token}).data.report.id;
 assert.equal(h.request('/staff/reports/'+restricted,{},handlerTokens).code,'NOT_FOUND');
 assert.equal(h.rows('Reports').find(r=>r.id===restricted).sensitive,true);
});
test('approved referrals, explicit resolution and independent further-review notifications',()=>{
 assert(h.request('/staff/settings',{type:'office',name:'Approved test office'},admin).ok);const office=h.rows('Offices')[0].id;
 assert(h.request('/staff/reports/'+id+'/action',{action:'refer',officeId:office,reason:'Follow up internally',publicExplanation:'Referred for further action'},admin).ok);assert.equal(h.request('/student/report',{},student).data.report.status,'Referred');
 const referral=h.rows('Referrals')[0];assert(h.request('/staff/reports/'+id+'/action',{action:'referral_outcome',referralId:referral.id,reason:'Follow-up completed'},admin).ok);assert.equal(h.request('/student/report',{},student).data.report.status,'Referred');
 assert(h.request('/staff/reports/'+id+'/action',{action:'status',status:'Resolved',reason:'Issue addressed'},admin).ok);
 const feedback=h.request('/student/action',{kind:'review_request',body:'Please independently reconsider the outcome.'},student);assert(feedback.ok,feedback.error);
 assert(h.rows('Notifications').some(n=>n.kind==='further_review'&&n.staff_id===reviewer.user_id));
 assert.equal(h.request('/staff/reports/'+id+'/action',{action:'status',status:'Closed',reason:'Try to skip independent review'},admin).code,'FORBIDDEN');
 assert(h.request('/staff/reports/'+id+'/action',{action:'status',status:'Under Review',reason:'Independent review started'},reviewerTokens).ok);
 assert(h.request('/staff/reports/'+id+'/action',{action:'status',status:'Resolved',reason:'Reviewed outcome'},reviewerTokens).ok);assert(h.request('/student/action',{kind:'confirmed',body:''},student).ok);assert.equal(h.request('/student/report',{},student).data.report.status,'Closed');
});
test('private attachments are returned only after report authorization',()=>{
 h.clearLimits();const submitted=h.request('/reports',{...concern(),attachments:[{name:'proof.png',data:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}]});assert(submitted.ok);const tokens={studentToken:h.request('/track',{code:submitted.data.trackingCode}).data.studentToken};const view=h.request('/student/report',{},tokens).data,file=view.attachments[0];assert(!JSON.stringify(view).includes('drive_id'));assert(h.request('/student/attachments/'+file.id,{},tokens).ok);assert.equal(h.request('/student/attachments/'+file.id,{},student).code,'NOT_FOUND');
 assert.equal(h.request('/reports',{...concern(),attachments:[{name:'bad.html',data:Buffer.from('<script>evil()</script>').toString('base64')}]}).code,'VALIDATION');
});
test('atomic failed writes create neither report nor credential, and spreadsheet cells cannot execute formulas',()=>{
 const before=h.rows('Reports').length;h.failNextBatch();assert.equal(h.request('/reports',concern()).code,'UNCERTAIN');assert.equal(h.rows('Reports').length,before);assert.equal(h.rows('Credentials').length,before);
 assert(h.request('/reports',{...concern(),subject:'=IMPORTXML("evil")'}).ok);const row=h.sheets.get('Reports').values.at(-1);assert(row[1].startsWith('{'));assert(JSON.parse(row[1]).subject.startsWith('='));
});
test('idle expiry, disabled accounts and password resets invalidate sessions',()=>{
 const session=h.rows('Sessions').find(s=>s.id===crypto.createHash('sha256').update(student.studentToken).digest('hex'));h.change('Sessions',session.id,{touched_at:Date.now()-31*60000});assert.equal(h.request('/student/report',{},student).code,'UNAUTHORIZED');
 h.change('Staff',reviewer.id,{enabled:false});assert.equal(h.request('/staff/options',{},reviewerTokens).code,'UNAUTHORIZED');h.change('Staff',reviewer.id,{enabled:true});
 assert(h.request('/staff/settings',{type:'staff',email:reviewer.email,name:'Reviewer',role:'restricted_reviewer',sensitiveAccess:true,enabled:true,password:'A replacement test password 2026!'},admin).ok);assert.equal(h.request('/staff/options',{},reviewerTokens).code,'UNAUTHORIZED');
});
test('failed tracking attempts remain rate limited and no public listing is exposed',()=>{
 h.clearLimits();for(let i=0;i<100;i++)assert.equal(h.request('/track',{code:'invalid'}).code,'UNAUTHORIZED');assert.equal(h.request('/track',{code:'invalid'}).code,'RATE_LIMIT');
 const output=JSON.parse(h.context.doGet({parameter:{action:'list'}}).text);assert.equal(output.ok,false);assert(!JSON.stringify(output).includes('Campus concern'));
});

test('legacy passwords migrate only on successful login and subsequent logins skip PBKDF2',()=>{
 const legacy=createHarness(),staff=legacy.rows('Staff')[0],password='Test-only initial password 2026!',salt='legacy-test-salt';
 legacy.change('Staff',staff.id,{password_scheme:null,password_salt:salt,password_iterations:600000,password_hash:crypto.pbkdf2Sync(password,salt,600000,32,'sha256').toString('hex')});
 assert.equal(legacy.request('/staff/login',{email:staff.email,password:'wrong-password'}).code,'UNAUTHORIZED');
 assert.equal(legacy.rows('Staff')[0].password_scheme,null);
 const result=legacy.request('/staff/login',{email:staff.email,password});assert(result.ok,result.error);
 assert.equal(legacy.rows('Staff')[0].password_scheme,'hmac-sha256-v1');
 legacy.context.DinigCrypto={derive(){throw Error('Fast verification must not call PBKDF2');}};
 assert(legacy.request('/staff/login',{email:staff.email,password}).ok);
 assert.equal(legacy.request('/staff/login',{email:staff.email,password:'wrong-password'}).code,'UNAUTHORIZED');
 assert.equal(legacy.request('/staff/login',{email:'unknown@example.invalid',password}).code,'UNAUTHORIZED');
 assert(legacy.request('/session',{}, {staffToken:result.data.staffToken}).data.staff);
});
