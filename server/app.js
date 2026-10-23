import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {database} from './database.js';
import {HttpError,fail,hash,secret,text,uuid,categories,statuses,cookies,cookieName,cookie,csrf,rateKey,readJSON} from './security.js';
import {one,submit,detail,message,studentAction,staffAction,audit} from './reports.js';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
export function createApp({pool,config,authenticate}){
 const tx=database(pool);
 const signIn=authenticate||(async(email,password)=>{
  const res=await fetch(`${config.supabase}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)fail(401,'Unable to sign in with those credentials.');
  const result=await res.json();if(!uuid(result.user?.id))fail(401,'Unable to sign in with those credentials.');
  return result.user.id;
 });
 async function session(req,kind){
  const token=cookies(req)[cookieName(config,kind)];if(!/^[\w-]{32}$/.test(token||''))return null;
  return tx(null,async db=>{
   const row=await one(db,`UPDATE dinig.sessions SET touched_at=now() WHERE token_hash=$1 AND kind=$2 AND expires_at>now() AND touched_at>now()-interval '30 minutes' RETURNING report_id,staff_id`,[hash(token),kind]);
   if(!row)return null;
   if(kind==='student')return {reportId:row.report_id};
   const profile=await one(db,'SELECT * FROM dinig.staff_profiles WHERE user_id=$1 AND enabled',[row.staff_id]);
   return profile?{staffId:row.staff_id,profile}:null;
  });
 }
 async function requireSession(req,kind){const actor=await session(req,kind);if(!actor)fail(401,kind==='staff'?'Please sign in to staff access.':'Enter your private tracking code to continue.');return actor;}
 async function limit(req,action,max,minutes=15){
  const row=await tx(null,db=>one(db,`INSERT INTO dinig.rate_limits(key,hits,reset_at) VALUES($1,1,now()+($2::text||' minutes')::interval)
   ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN dinig.rate_limits.reset_at<now() THEN 1 ELSE dinig.rate_limits.hits+1 END,
   reset_at=CASE WHEN dinig.rate_limits.reset_at<now() THEN excluded.reset_at ELSE dinig.rate_limits.reset_at END RETURNING hits`,[rateKey(req,config,action),minutes]));
  if(row.hits>max)fail(429,'Too many attempts. Please wait before trying again.');
 }
 function send(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
 async function newSession(res,kind,actor){const token=secret();await tx(null,db=>db.query("INSERT INTO dinig.sessions(token_hash,kind,report_id,staff_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",[hash(token),kind,actor.reportId||null,actor.staffId||null]));res.setHeader('Set-Cookie',cookie(config,kind,token,8*3600));}
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  if(config.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,config.origin),route=url.pathname;
   if(req.method==='GET'&&route==='/health'){send(res,{ok:true});return;}
   if(req.method==='GET'&&route==='/ready'){
    try{const value=await tx(null,db=>one(db,"SELECT EXISTS(SELECT 1 FROM dinig.staff_profiles WHERE enabled AND role='administrator') AS ready"));send(res,{ok:!!value.ready},value.ready?200:503);}catch{send(res,{ok:false},503);}return;
   }
   if(!route.startsWith('/api/')){
    if(!['GET','HEAD'].includes(req.method))fail(405,'Method not allowed.');
    const filename=['/','/submit','/track','/staff'].includes(route)?'index.html':decodeURIComponent(route.slice(1));
    const full=path.resolve(root,filename);if(!full.startsWith(root)||!types[path.extname(full)])fail(404,'Page not found.');
    let bytes;try{bytes=await fs.readFile(full);}catch{fail(404,'Page not found.');}
    res.writeHead(200,{'Content-Type':types[path.extname(full)]});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(req.method==='GET'&&route==='/api/session'){
    let token=cookies(req)[cookieName(config,'csrf')];if(!/^[\w-]{32}$/.test(token||'')){token=secret();res.setHeader('Set-Cookie',cookie(config,'csrf',token,8*3600));}
    const staff=await session(req,'staff'),student=await session(req,'student');
    const routingStaff=await tx(null,async db=>(await db.query('SELECT public_id,display_name FROM dinig.staff_profiles WHERE enabled ORDER BY display_name')).rows);
    send(res,{csrf:token,staff:staff?.profile?{id:staff.staffId,name:staff.profile.display_name,role:staff.profile.role}:null,student:!!student,categories,statuses,routingStaff,emergencyGuidance:config.emergencyGuidance,responseGuidance:config.responseGuidance});return;
   }
   const mutation=req.method==='POST';let body;
   if(mutation){csrf(req,config);await limit(req,'mutations',120);body=await readJSON(req,route==='/api/reports'||route.endsWith('/message')?15*1024*1024:64*1024);}
   else if(req.method!=='GET')fail(405,'Method not allowed.');
   if(mutation&&route==='/api/reports'){
    await limit(req,'submissions',5,60);
    try{send(res,await tx({creating:true},db=>submit(db,body)),201);}catch(e){if(e.code==='23505')fail(409,'This submission was already received. Use its confirmation details.');throw e;}return;
   }
   if(mutation&&route==='/api/track'){
    await limit(req,'tracking',10);
    // Hash any input to keep failure behavior generic; code never leaves POST body.
    const value=typeof body.code==='string'?body.code.trim():'';
    const found=await tx(null,db=>one(db,'SELECT report_id FROM dinig.report_access_credentials WHERE code_hash=$1',[hash(value.slice(0,256))]));
    if(!found||!/^[\w-]{32}$/.test(value))fail(401,'That tracking code could not be verified. Check the code and try again.');
    await newSession(res,'student',{reportId:found.report_id});send(res,{ok:true});return;
   }
   if(mutation&&route==='/api/staff/login'){
    await limit(req,'login',10);text(body.password,'Password',1,256);const id=await signIn(text(body.email,'Email',1,254),body.password);
    const staff=await tx(null,db=>one(db,'SELECT user_id FROM dinig.staff_profiles WHERE user_id=$1 AND enabled',[id]));
    if(!staff)fail(401,'Unable to sign in with those credentials.');
    await newSession(res,'staff',{staffId:id});send(res,{ok:true});return;
   }
   if(mutation&&['/api/student/logout','/api/staff/logout'].includes(route)){
    const kind=route.includes('/staff/')?'staff':'student',token=cookies(req)[cookieName(config,kind)]||'';
    await tx(null,db=>db.query('DELETE FROM dinig.sessions WHERE token_hash=$1 AND kind=$2',[hash(token),kind]));res.setHeader('Set-Cookie',cookie(config,kind,'',0));send(res,{ok:true});return;
   }
   if(route.startsWith('/api/student/')){
    const actor=await requireSession(req,'student');
    if(req.method==='GET'&&route==='/api/student/report'){send(res,await tx(actor,db=>detail(db,actor.reportId)));return;}
    if(mutation&&route==='/api/student/message'){await limit(req,'student-messages',20);send(res,await tx(actor,db=>message(db,actor,actor.reportId,body)));return;}
    if(mutation&&route==='/api/student/action'){await limit(req,'student-actions',10);send(res,await tx(actor,db=>studentAction(db,actor,body)));return;}
   }
   if(req.method==='GET'&&/^\/api\/(student|staff)\/attachments\/[a-f\d-]+$/.test(route)){
    const [,kind,id]=route.match(/^\/api\/(student|staff)\/attachments\/([a-f\d-]+)$/),actor=await requireSession(req,kind);
    if(!uuid(id))fail(404,'Attachment not found.');
    const file=await tx(actor,async db=>{const value=await one(db,'SELECT report_id,name,mime,content FROM dinig.report_attachments WHERE id=$1',[id]);if(value&&kind==='staff')await audit(db,actor,value.report_id,'download_attachment');return value;});
    if(!file)fail(404,'Attachment not found.');
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`});res.end(Buffer.from(file.content));return;
   }
   if(route.startsWith('/api/staff/')){
    const actor=await requireSession(req,'staff');
    if(req.method==='GET'&&route==='/api/staff/reports'){
     const terms=[],args=[];const add=(column,value)=>{if(value){args.push(value);terms.push(`${column}=$${args.length}`);}};
     add('r.category',url.searchParams.get('category'));add('r.status',url.searchParams.get('status'));add('r.priority',url.searchParams.get('priority'));
     const handler=url.searchParams.get('handler');if(handler){if(!uuid(handler))fail(400,'Invalid handler filter.');args.push(handler);terms.push(`EXISTS(SELECT 1 FROM dinig.report_assignments a WHERE a.report_id=r.id AND a.staff_id=$${args.length})`);}
     for(const [key,op]of [['from','>='],['to','<=']]){const value=url.searchParams.get(key);if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'Invalid date filter.');args.push(value);terms.push(`r.created_at::date${op}$${args.length}::date`);}}
     const search=url.searchParams.get('q');if(search){args.push('%'+text(search,'Search',1,180)+'%');terms.push(`(r.reference ILIKE $${args.length} OR r.subject ILIKE $${args.length} OR r.code_name ILIKE $${args.length})`);}
     const queue=url.searchParams.get('queue');if(queue==='unassigned')terms.push('NOT EXISTS(SELECT 1 FROM dinig.report_assignments a WHERE a.report_id=r.id)');
     if(queue==='mine'){args.push(actor.staffId);terms.push(`EXISTS(SELECT 1 FROM dinig.report_assignments a WHERE a.report_id=r.id AND a.staff_id=$${args.length})`);}
     if(queue==='overdue')terms.push("r.due_at<now() AND r.status NOT IN ('Resolved','Closed')");
     if(queue==='review')terms.push('r.review_requested');
     const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));args.push(offset);
     const rows=await tx(actor,db=>db.query(`SELECT r.id,r.reference,r.subject,r.code_name,r.category,r.status,r.priority,r.created_at,r.due_at,r.review_requested,r.sensitive FROM dinig.reports r ${terms.length?'WHERE '+terms.join(' AND '):''} ORDER BY r.created_at DESC LIMIT 50 OFFSET $${args.length}`,args));send(res,{reports:rows.rows});return;
    }
    if(req.method==='GET'&&route==='/api/staff/options'){
     send(res,await tx(actor,async db=>({staff:(await db.query('SELECT user_id,display_name,role,sensitive_access,enabled FROM dinig.staff_profiles ORDER BY display_name')).rows,offices:(await db.query('SELECT * FROM dinig.approved_offices WHERE enabled ORDER BY name')).rows,...(actor.profile.role==='administrator'?{routing:(await db.query('SELECT * FROM dinig.routing_rules ORDER BY category')).rows,retentionDays:config.retentionDays}:{})})));return;
    }
    if(mutation&&route==='/api/staff/settings'){
     if(actor.profile.role!=='administrator')fail(403,'Administrator access is required.');
     send(res,await tx(actor,async db=>{
      if(body.type==='staff'){
       if(!uuid(body.userId)||!['administrator','handler','restricted_reviewer'].includes(body.role))fail(400,'Enter an existing authenticated account UUID and a valid role.');
       if(body.userId===actor.staffId)fail(400,'Another administrator must change your own permissions.');
       if(body.sensitiveAccess&&body.role==='handler')fail(400,'Sensitive access requires a reviewer or administrator role.');
       try{await db.query(`INSERT INTO dinig.staff_profiles(user_id,display_name,role,enabled,sensitive_access) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,enabled=excluded.enabled,sensitive_access=excluded.sensitive_access`,[body.userId,text(body.name,'Staff name',1,100),body.role,body.enabled===true,body.sensitiveAccess===true]);}catch(e){if(e.code==='23503')fail(400,'That account does not exist in the authentication provider.');throw e;}
      }else if(body.type==='office'){await db.query('INSERT INTO dinig.approved_offices(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET enabled=true',[text(body.name,'Approved office',1,160)]);
      }else if(body.type==='routing'){
       if(!categories.includes(body.category)||body.reviewerId&&!uuid(body.reviewerId))fail(400,'Choose a category and valid reviewer.');
       if(body.targetHours!==null&&(!Number.isInteger(body.targetHours)||body.targetHours<1||body.targetHours>8760))fail(400,'Enter target hours from 1 to 8760, or leave blank.');
       const reviewer=body.reviewerId?await one(db,'SELECT * FROM dinig.staff_profiles WHERE user_id=$1 AND enabled',[body.reviewerId]):null;
       if(body.restricted&&(!reviewer?.sensitive_access||!['administrator','restricted_reviewer'].includes(reviewer.role)))fail(400,'Restricted routing needs an enabled authorized reviewer.');
       if(body.reviewerId&&!reviewer)fail(400,'Choose an enabled handler.');
       await db.query('UPDATE dinig.routing_rules SET restricted=$2,reviewer_id=$3,target_hours=$4 WHERE category=$1',[body.category,body.restricted===true,body.reviewerId||null,body.targetHours]);
      }else fail(400,'Unknown setting.');
      // Configuration actions have no report. Audit INSERT policy is scoped to
      // report data, so log a metadata-only event through a separate policy.
      await audit(db,actor,null,'settings_'+body.type);return {ok:true};
     }));return;
    }
    const match=route.match(/^\/api\/staff\/reports\/([a-f\d-]+)(?:\/(message|action))?$/);
    if(match&&uuid(match[1])){
     if(req.method==='GET'&&!match[2]){send(res,await tx(actor,async db=>{const value=await detail(db,match[1],true);await audit(db,actor,match[1],'view_report');return value;}));return;}
     if(mutation&&match[2]==='message'){await limit(req,'staff-messages',40);send(res,await tx(actor,db=>message(db,actor,match[1],body)));return;}
     if(mutation&&match[2]==='action'){send(res,await tx(actor,db=>staffAction(db,actor,match[1],body)));return;}
    }
   }
   fail(404,'Page not found.');
  }catch(error){
   // Never log request bodies, passwords, tracking codes, database URLs or SQL.
   if(!(error instanceof HttpError))console.error('D.I.N.I.G. request failed:',/^[\w]{1,12}$/.test(error.code||'')?error.code:'internal');
   if(!res.headersSent){if(error.status===429)res.setHeader('Retry-After','900');send(res,{error:error instanceof HttpError?error.message:'The request could not be completed. Please try again.'},error.status||500);}else res.end();
  }
 };
}
