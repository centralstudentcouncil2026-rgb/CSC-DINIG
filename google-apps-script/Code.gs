/** CSC D.I.N.I.G. — private Google Sheets + Drive backend.
 * Only doGet/doPost dispatch requests. All helpers end in an underscore.
 * Configure Script properties, run setup from the editor, deploy execute as Me.
 * No tracking/password/session secrets are logged or returned by health checks.
 */
const DINIG_CATEGORIES = ['Academic','Facilities','Student Services','Safety and Welfare','Organizations','Ideas and Suggestions','Others'];
const DINIG_STATUSES = ['Submitted','Under Review','Awaiting Student Response','In Progress','Referred','Resolved','Closed'];
const DINIG_TABLES = ['Reports','Credentials','Messages','Attachments','History','Assignments','Referrals','Staff','Audit','Feedback','Notifications','Routing','Offices','Sessions','RateLimits','SubmissionKeys','Commits'];
const DINIG_IDLE = 30 * 60 * 1000, DINIG_ABSOLUTE = 8 * 60 * 60 * 1000;
const DINIG_PASSWORD_ITERATIONS = 600000;

function setup() {
 const props=PropertiesService.getScriptProperties();
 if(!/^[a-f\d]{64,}$/i.test(props.getProperty('TOKEN_SECRET')||''))throw Error('Set TOKEN_SECRET to a cryptographically generated 64-character hex secret. See SETUP.md.');
 if(typeof DinigCrypto==='undefined')throw Error('Add the supplied Crypto.gs file before running setup.');
 if(typeof Sheets==='undefined')throw Error('Enable Google Sheets API v4 under Services (+), then run setup again.');
 const existing=props.getProperty('SPREADSHEET_ID');
 const spreadsheet=existing?SpreadsheetApp.openById(existing):SpreadsheetApp.create('CSC D.I.N.I.G. — Private Database');
 assertPrivate_(DriveApp.getFileById(spreadsheet.getId()));
 props.setProperty('SPREADSHEET_ID',spreadsheet.getId());
 DINIG_TABLES.forEach(name=>{const sheet=spreadsheet.getSheetByName(name)||spreadsheet.insertSheet(name);if(!sheet.getLastRow()){sheet.getRange(1,1,1,3).setValues([['id','record_json','updated_at']]);sheet.setFrozenRows(1);sheet.getRange(1,1,1,3).setFontWeight('bold').setBackground('#fff2bc');}else if(sheet.getRange(1,1,1,3).getValues()[0].join('|')!=='id|record_json|updated_at')throw Error('Unexpected table headers: '+name);});
 // Finish SpreadsheetApp's buffered tab/header writes before the separate API.
 SpreadsheetApp.flush();
 // This read-only preflight exposes Google's service/permission error in the
 // owner editor without logging a write payload containing account data.
 Sheets.Spreadsheets.get(spreadsheet.getId(),{fields:'spreadsheetId'});
 let folder;
 if(props.getProperty('ATTACHMENT_FOLDER_ID'))folder=DriveApp.getFolderById(props.getProperty('ATTACHMENT_FOLDER_ID'));
 else{folder=DriveApp.createFolder('CSC D.I.N.I.G. — Private Attachments');props.setProperty('ATTACHMENT_FOLDER_ID',folder.getId());}
 assertPrivate_(folder);
 locked_(function(){const db=store_();if(!rows_(db,'Staff').some(s=>s.email==='aupcscdinig@aup.edu.ph')){const password=props.getProperty('ADMIN_PASSWORD')||'';text_(password,'Initial administrator password',12,256);const adminId=Utilities.getUuid();put_(db,'Staff',Object.assign({id:adminId,user_id:adminId,public_id:Utilities.getUuid(),email:'aupcscdinig@aup.edu.ph',display_name:'D.I.N.I.G. Administrator',role:'administrator',enabled:true,sensitive_access:true,created_at:now_()},passwordRecord_(password)));}DINIG_CATEGORIES.forEach(category=>{if(!get_(db,'Routing',category))put_(db,'Routing',{id:category,category:category,restricted:false,reviewer_id:null,target_hours:null});});commit_(db);});
 props.deleteProperty('ADMIN_PASSWORD');
 console.log('Setup complete. Private database: '+spreadsheet.getUrl());
}

function doGet(e) {
 // No public report listing, credential lookup, file endpoint or staff directory.
 return respond_(function(){if(e&&e.parameter&&e.parameter.action==='health')return {service:'CSC D.I.N.I.G.',configured:!!PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),backendVersion:'trace-style-login-v1',fastAdminReady:!!PropertiesService.getScriptProperties().getProperty('FAST_ADMIN_RECORD')};fail_('INVALID_ACTION','Use the application to access this service.');});
}
function doPost(e) {
 return respond_(function(){const raw=e&&e.postData&&e.postData.contents;if(!raw||raw.length>15*1024*1024)fail_('INVALID_REQUEST','The request is missing or too large.');let input;try{input=JSON.parse(raw);}catch(ignore){fail_('INVALID_REQUEST','The request could not be read.');}if(!input||typeof input!=='object'||Array.isArray(input))fail_('INVALID_REQUEST','Invalid request.');return execute_(input);});
}
function respond_(fn){let result;try{result={ok:true,data:fn()};}catch(error){result={ok:false,code:error.dinigCode||'INTERNAL',error:error.dinigCode?error.message:'The request could not be completed. Try again later.'};}return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);}
function fail_(code,message){const error=new Error(message);error.dinigCode=code;throw error;}
function now_(){return new Date().toISOString();}
function uuid_(value){return typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);}
function text_(value,label,min,max){if(typeof value!=='string'||value.trim().length<min||value.length>max||value.indexOf('\0')!==-1)fail_('VALIDATION',label+' must contain '+min+'–'+max+' characters.');return value.trim();}
function hash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function token_(purpose){const key=PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');if(!/^[a-f\d]{64,}$/i.test(key||''))fail_('NOT_CONFIGURED','This service is not configured.');const nonce=purpose+'|'+Utilities.getUuid()+'|'+Utilities.getUuid()+'|'+Date.now();return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(nonce,key,Utilities.Charset.UTF_8)).replace(/=+$/,'');}
// Fast verifier requested for Apps Script latency. The server-only HMAC key
// protects a Sheet-only leak, but this has no adaptive password work factor.
function passwordDigest_(password,salt){const key=PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');if(!/^[a-f\d]{64,}$/i.test(key||''))fail_('NOT_CONFIGURED','This service is not configured.');return Utilities.computeHmacSha256Signature('DINIG|password|v1|'+JSON.stringify([salt,password]),key,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function passwordRecord_(password){text_(password,'Password',12,256);const salt=token_('password-salt');return {password_scheme:'hmac-sha256-v1',password_hash:passwordDigest_(password,salt),password_salt:salt,password_iterations:0,auth_version:Utilities.getUuid()};}
function equal_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
// Editor-only recovery; no public password recovery/reset action exists.
function resetAdminPassword(){const props=PropertiesService.getScriptProperties(),password=props.getProperty('ADMIN_PASSWORD')||'';locked_(function(){const db=store_(),admin=rows_(db,'Staff').find(s=>s.email==='aupcscdinig@aup.edu.ph'&&s.role==='administrator');if(!admin)throw Error('Run setup first.');put_(db,'Staff',Object.assign({},admin,passwordRecord_(password)));audit_(db,{staffId:admin.user_id},null,'owner_password_reset');commit_(db);});props.deleteProperty('ADMIN_PASSWORD');prepareFastAdminLogin();console.log('Administrator password reset. Existing administrator sessions are invalidated.');}
function locked_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(15000))fail_('BUSY','The service is busy. Try again shortly.');try{return fn();}finally{lock.releaseLock();}}
function assertPrivate_(file){if(file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('The database and attachment folder must remain Restricted with no additional editors or viewers. Assign staff through the application instead.');}

// JSON is stored through stringValue, never as a Sheets formula. Per-row JSON
// is split into bounded cells; Sheets batchUpdate commits all entities atomically.
function store_(){const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)fail_('NOT_CONFIGURED','The council is preparing this service.');return {spreadsheet:SpreadsheetApp.openById(id),tables:{},dirty:{}};}
function table_(db,name){if(DINIG_TABLES.indexOf(name)<0)throw Error('Unknown table');if(!db.tables[name]){const sheet=db.spreadsheet.getSheetByName(name);if(!sheet)fail_('NOT_CONFIGURED','Run the service setup first.');const values=sheet.getDataRange().getValues().slice(1);const rows=[];values.forEach((row,index)=>{if(row[0]){const record=JSON.parse(row[1]);record._row=index+1;rows.push(record);}});db.tables[name]={sheet:sheet,rows:rows};}return db.tables[name];}
function rows_(db,name){return table_(db,name).rows.filter(r=>!r._deleted);}
function get_(db,name,id){return rows_(db,name).find(r=>r.id===id)||null;}
function put_(db,name,value){const table=table_(db,name);let current=table.rows.find(r=>r.id===value.id);if(current){Object.assign(current,value);}else{current=Object.assign({_row:table.rows.reduce((max,r)=>Math.max(max,r._row),0)+1},value);table.rows.push(current);}if(!db.dirty[name])db.dirty[name]={};db.dirty[name][value.id]=true;return current;}
function remove_(db,name,id){const row=get_(db,name,id);if(row)put_(db,name,Object.assign({},row,{_deleted:true}));}
function clean_(row){const result={};Object.keys(row).forEach(key=>{if(key.charAt(0)!=='_')result[key]=row[key];});return result;}
function commit_(db){
 const requests=[],commitId=Utilities.getUuid();
 if(!Object.keys(db.dirty).length)return;
 put_(db,'Commits',{id:commitId,created_at:now_()});
 Object.keys(db.dirty).forEach(name=>{const table=table_(db,name),maxRow=table.rows.reduce((max,r)=>Math.max(max,r._row),0)+1;if(maxRow>table.sheet.getMaxRows())requests.push({appendDimension:{sheetId:table.sheet.getSheetId(),dimension:'ROWS',length:maxRow-table.sheet.getMaxRows()}});table.rows.filter(row=>db.dirty[name][row.id]).forEach(row=>{const data=Object.assign({},clean_(row),row._deleted?{_deleted:true}:{}),json=JSON.stringify(data);if(json.length>45000)fail_('VALIDATION','This record is too large. Shorten the message or field.');requests.push({updateCells:{range:{sheetId:table.sheet.getSheetId(),startRowIndex:row._row,endRowIndex:row._row+1,startColumnIndex:0,endColumnIndex:3},rows:[{values:[row.id,json,now_()].map(value=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}});});});
 try{Sheets.Spreadsheets.batchUpdate({requests:requests},db.spreadsheet.getId());}catch(error){fail_('UNCERTAIN','The update could not be confirmed. Refresh to check its status before retrying.');}
}
function add_(db,name,data){return put_(db,name,Object.assign({id:Utilities.getUuid(),created_at:now_()},data));}
function audit_(db,actor,reportId,action){add_(db,'Audit',{actor_id:actor.staffId||null,report_id:reportId||null,action:action});}
function limit_(db,key,max,windowMs){const slot=Math.floor(Date.now()/windowMs),id=hash_(key+'|'+slot);let record=get_(db,'RateLimits',id)||{id:id,hits:0,expires_at:Date.now()+windowMs*2};record.hits++;put_(db,'RateLimits',record);if(record.hits>max)fail_('RATE_LIMIT','Too many attempts. Please wait before trying again.');}
function session_(db,token,kind){if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))return null;if(kind==='staff'){const cached=cachedStaffSession_(db,token);if(cached)return cached;}const row=get_(db,'Sessions',hash_(token));if(!row||row.kind!==kind||row.expires_at<=Date.now()||row.touched_at<Date.now()-DINIG_IDLE)return null;if(kind==='staff'){const staff=get_(db,'Staff',row.staff_id);if(!staff||!staff.enabled||row.auth_version!==staff.auth_version)return null;row.profile=clean_(staff);}const profile=row.profile;delete row.profile;put_(db,'Sessions',Object.assign({},row,{touched_at:Date.now()}));return kind==='staff'?{staffId:row.staff_id,profile:profile}:{reportId:row.report_id};}
function requireSession_(db,input,kind){const actor=session_(db,kind==='staff'?input.staffToken:input.studentToken,kind);if(!actor)fail_('UNAUTHORIZED',kind==='staff'?'Please sign in to staff access.':'Enter your private tracking code to continue.');return actor;}
function newSession_(db,kind,actor){const value=token_('session:'+kind);put_(db,'Sessions',{id:hash_(value),kind:kind,staff_id:actor.staffId||null,auth_version:actor.staffId?get_(db,'Staff',actor.staffId).auth_version:null,report_id:actor.reportId||null,touched_at:Date.now(),expires_at:Date.now()+DINIG_ABSOLUTE});return value;}
function allowed_(db,actor,report){if(!report)return false;if(actor.reportId)return actor.reportId===report.id;const s=actor.profile;if(!s||!s.enabled||(report.conflict_staff||[]).indexOf(actor.staffId)!==-1)return false;const assigned=rows_(db,'Assignments').some(a=>a.report_id===report.id&&a.staff_id===actor.staffId);return report.sensitive?(s.sensitive_access&&assigned&&['administrator','restricted_reviewer'].indexOf(s.role)!==-1):(s.role==='administrator'||assigned);}
function report_(db,actor,id){const report=get_(db,'Reports',id);if(!allowed_(db,actor,report))fail_('NOT_FOUND','Concern not found.');return report;}

// TRACE-style single-admin credential snapshot. Only hashed credentials live
// in Script properties. Run this editor-only helper after direct staff changes.
function prepareFastAdminLogin(){locked_(function(){const db=store_();warmFastAdmin_(db);});console.log('Single-admin login settings refreshed.');}
function warmFastAdmin_(db){const props=PropertiesService.getScriptProperties(),staff=rows_(db,'Staff');if(staff.length===1&&staff[0].enabled&&staff[0].role==='administrator'&&staff[0].email==='aupcscdinig@aup.edu.ph'&&staff[0].password_scheme==='hmac-sha256-v1')props.setProperty('FAST_ADMIN_RECORD',JSON.stringify(clean_(staff[0])));else props.deleteProperty('FAST_ADMIN_RECORD');}
function fastAdmin_(){const raw=PropertiesService.getScriptProperties().getProperty('FAST_ADMIN_RECORD');if(!raw)return null;try{const row=JSON.parse(raw);return row.enabled&&row.role==='administrator'&&row.password_scheme==='hmac-sha256-v1'?row:null;}catch(ignore){return null;}}
function staffSummary_(staff){return {id:staff.user_id,name:staff.display_name,role:staff.role};}
function fastLogin_(body,staff){
 const cache=CacheService.getScriptCache(),slot=Math.floor(Date.now()/300000),key='fast-login-attempts:'+slot,hits=Number(cache.get(key)||0);if(hits>=10)fail_('RATE_LIMIT','Too many login attempts. Try again in five minutes.');cache.put(key,String(hits+1),600);
 const email=text_(body.email,'Email',1,254).toLowerCase();text_(body.password,'Password',1,256);
 const calculated=passwordDigest_(body.password,staff.password_salt);
 if(!equal_(hash_(email),hash_(staff.email))||!equal_(calculated,staff.password_hash))fail_('UNAUTHORIZED','Unable to sign in with those credentials.');
 const token=token_('fast-admin-session'),row={staff_id:staff.user_id,auth_version:staff.auth_version,touched_at:Date.now(),expires_at:Date.now()+DINIG_ABSOLUTE,login_id:Utilities.getUuid(),login_at:now_(),audited:false};
 cache.put('fast-admin-session:'+hash_(token),JSON.stringify(row),1800);
 return {staffToken:token,fastLogin:true,bootstrap:{session:{csrf:'',student:false,staff:staffSummary_(staff),categories:DINIG_CATEGORIES,statuses:DINIG_STATUSES,routingStaff:[],emergencyGuidance:'',responseGuidance:''}}};
}
function cachedStaffSession_(db,token){
 const cache=CacheService.getScriptCache(),key='fast-admin-session:'+hash_(token),raw=cache.get(key);if(!raw)return null;
 let row;try{row=JSON.parse(raw);}catch(ignore){cache.remove(key);return null;}
 const staff=get_(db,'Staff',row.staff_id);
 if(row.expires_at<=Date.now()||row.touched_at<Date.now()-DINIG_IDLE||!staff||!staff.enabled||staff.auth_version!==row.auth_version){cache.remove(key);return null;}
 if(!row.audited){put_(db,'Audit',{id:row.login_id,actor_id:row.staff_id,report_id:null,action:'staff_login',created_at:row.login_at});if(!db.fastAudits)db.fastAudits=[];db.fastAudits.push(key);}
 row.touched_at=Date.now();cache.put(key,JSON.stringify(row),Math.max(1,Math.min(1800,Math.ceil((row.expires_at-Date.now())/1000))));
 return {staffId:row.staff_id,profile:clean_(staff)};
}
function finishFastAudits_(db){(db.fastAudits||[]).forEach(key=>{const cache=CacheService.getScriptCache(),raw=cache.get(key);if(raw){const row=JSON.parse(raw);row.audited=true;cache.put(key,JSON.stringify(row),Math.max(1,Math.min(1800,Math.ceil((row.expires_at-Date.now())/1000))));}});}
function execute_(input){
 // Single-admin login bypasses SpreadsheetApp and Sheets writes entirely.
 if(input.path==='/staff/login'&&input.body){const staff=fastAdmin_();if(staff)return locked_(function(){return fastLogin_(input.body,staff);});}

 return locked_(function(){const db=store_();let result;
 try{result=dispatch_(db,input);}catch(error){
  // Failed tracking/login attempts must still consume rate-limit buckets. No
  // report writes are committed on a failed operation.
  const rates=db.dirty.RateLimits;db.dirty=rates?{RateLimits:rates}:{};commit_(db);throw error;
 }
 commit_(db);if(db.warmFastAdmin)warmFastAdmin_(db);finishFastAudits_(db);return result;});
}
function dispatch_(db,input){
 const path=text_(input.path,'Action',1,240),body=input.body||{};
 if(path==='/session'){
  const student=session_(db,input.studentToken,'student'),staff=session_(db,input.staffToken,'staff'),props=PropertiesService.getScriptProperties();
  return {csrf:'',student:!!student,staff:staff?{id:staff.staffId,name:staff.profile.display_name,role:staff.profile.role}:null,categories:DINIG_CATEGORIES,statuses:DINIG_STATUSES,routingStaff:rows_(db,'Staff').filter(s=>s.enabled).map(s=>({public_id:s.public_id,display_name:s.display_name})),emergencyGuidance:props.getProperty('EMERGENCY_GUIDANCE')||'',responseGuidance:props.getProperty('RESPONSE_GUIDANCE')||''};
 }
 if(path==='/reports'){limit_(db,'submissions-global',60,3600000);return submit_(db,body);}
 if(path==='/track'){
  limit_(db,'tracking-global',100,900000);const code=typeof body.code==='string'?body.code.trim():'';
  const credential=/^[\w-]{43}$/.test(code)?rows_(db,'Credentials').find(r=>r.code_hash===hash_(code)):null;
  if(!credential)fail_('UNAUTHORIZED','That tracking code could not be verified. Check the code and try again.');
  return {studentToken:newSession_(db,'student',{reportId:credential.report_id})};
 }
 if(path==='/staff/login')return login_(db,body);
 if(path==='/student/logout'||path==='/staff/logout'){const token=path==='/staff/logout'?input.staffToken:input.studentToken;if(typeof token==='string'){if(path==='/staff/logout')CacheService.getScriptCache().remove('fast-admin-session:'+hash_(token));remove_(db,'Sessions',hash_(token));}return {ok:true};}
 const staffPath=path.indexOf('/staff/')===0,actor=requireSession_(db,input,staffPath?'staff':'student');
 const fileMatch=path.match(/^\/(student|staff)\/attachments\/([a-f\d-]+)$/i);
 if(fileMatch){const file=get_(db,'Attachments',fileMatch[2]);if(!file)fail_('NOT_FOUND','Attachment not found.');report_(db,actor,file.report_id);const blob=DriveApp.getFileById(file.drive_id).getBlob();if(actor.staffId)audit_(db,actor,file.report_id,'download_attachment');return {name:file.name,mime:file.mime,data:Utilities.base64Encode(blob.getBytes())};}
 if(path==='/student/report')return detail_(db,actor,actor.reportId);
 if(path==='/student/message'){limit_(db,'message:'+hash_(input.studentToken),20,900000);return message_(db,actor,actor.reportId,body);}
 if(path==='/student/action'){limit_(db,'feedback:'+hash_(input.studentToken),10,900000);return feedback_(db,actor,body);}
 const reportMatch=path.match(/^\/staff\/reports\/([a-f\d-]+)(?:\/(message|action))?$/i);
 if(reportMatch){if(reportMatch[2]==='message'){limit_(db,'message:'+actor.staffId,40,900000);return message_(db,actor,reportMatch[1],body);}if(reportMatch[2]==='action')return staffAction_(db,actor,reportMatch[1],body);const value=detail_(db,actor,reportMatch[1]);audit_(db,actor,reportMatch[1],'view_report');return value;}
 if(path.split('?')[0]==='/staff/reports')return list_(db,actor,path);
 if(path==='/staff/options')return {staff:rows_(db,'Staff').map(s=>pick_(s,actor.profile.role==='administrator'?['user_id','email','display_name','role','sensitive_access','enabled']:['user_id','display_name','role','sensitive_access','enabled'])),offices:rows_(db,'Offices').filter(o=>o.enabled!==false).map(clean_),routing:actor.profile.role==='administrator'?rows_(db,'Routing').map(clean_):undefined,retentionDays:Number(PropertiesService.getScriptProperties().getProperty('RETENTION_DAYS')||365)};
 if(path==='/staff/startup')return {options:dispatch_(db,{path:'/staff/options',staffToken:input.staffToken}),list:list_(db,actor,'/staff/reports?offset=0')};
 if(path==='/staff/settings')return settings_(db,actor,body);
 fail_('INVALID_ACTION','Unknown action.');
}
function pick_(record,keys){const output={};keys.forEach(key=>output[key]=record[key]);return output;}

function login_(db,body){
 limit_(db,'staff-login-global',10,300000);
 const email=text_(body.email,'Email',1,254).toLowerCase();text_(body.password,'Password',1,256);
 const staff=rows_(db,'Staff').find(s=>s.email===email),salt=staff?staff.password_salt:'unrecognized-account-dummy-salt';
 const legacy=staff&&!staff.password_scheme&&staff.password_iterations===DINIG_PASSWORD_ITERATIONS;
 const calculated=legacy?DinigCrypto.derive(body.password,salt,DINIG_PASSWORD_ITERATIONS):passwordDigest_(body.password,salt);
 if(!staff||!staff.enabled||(!legacy&&staff.password_scheme!=='hmac-sha256-v1')||!equal_(calculated,staff.password_hash))fail_('UNAUTHORIZED','Unable to sign in with those credentials.');
 if(legacy){put_(db,'Staff',Object.assign({},staff,passwordRecord_(body.password)));audit_(db,{staffId:staff.user_id},null,'password_verifier_migrated');}
 audit_(db,{staffId:staff.user_id},null,'staff_login');
 const staffToken=newSession_(db,'staff',{staffId:staff.user_id});
 // Bootstrap in the same locked transaction and reuse the same authorization
 // and serializers as separate requests. No extra network trips or Sheet opens.
 const bootstrap=body.bootstrap===true?{
  session:dispatch_(db,{path:'/session',staffToken:staffToken}),
  options:dispatch_(db,{path:'/staff/options',staffToken:staffToken}),
  list:dispatch_(db,{path:'/staff/reports?offset=0',staffToken:staffToken})
 }:undefined;
 if(body.fast===true)db.warmFastAdmin=true;
 return {staffToken:staffToken,bootstrap:bootstrap};
}
function validateFiles_(items){
 if(items===undefined)return [];
 if(!Array.isArray(items)||items.length>3)fail_('VALIDATION','Attach up to three files.');let total=0;
 return items.map(file=>{const name=text_(file.name,'File name',1,120).replace(/[\x00-\x1f\x7f/\\]/g,'_');if(typeof file.data!=='string'||file.data.length>6990512||! /^[A-Za-z0-9+/]*={0,2}$/.test(file.data))fail_('VALIDATION','Invalid attachment.');let bytes;try{bytes=Utilities.base64Decode(file.data);}catch(ignore){fail_('VALIDATION','Invalid attachment.');}total+=bytes.length;if(!bytes.length||bytes.length>5242880||total>10485760)fail_('VALIDATION','Each file must be at most 5 MB; combined files at most 10 MB.');const b=bytes.map(n=>(n+256)%256),ext=name.split('.').pop().toLowerCase();let mime;if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))mime='image/png';else if(b[0]===255&&b[1]===216&&b[2]===255)mime='image/jpeg';else if(String.fromCharCode.apply(null,b.slice(0,5))==='%PDF-')mime='application/pdf';if(!mime||({'image/png':['png'],'image/jpeg':['jpg','jpeg'],'application/pdf':['pdf']}[mime].indexOf(ext)<0))fail_('VALIDATION','Only matching PNG, JPEG or PDF files are supported.');return {name:name,mime:mime,bytes:bytes,size:bytes.length};});
}
function saveFiles_(db,reportId,files,messageId){if(!files.length)return;const folder=DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('ATTACHMENT_FOLDER_ID'));assertPrivate_(folder);files.forEach(item=>{const file=folder.createFile(Utilities.newBlob(item.bytes,item.mime,item.name));assertPrivate_(file);add_(db,'Attachments',{report_id:reportId,message_id:messageId||null,name:item.name,mime:item.mime,size:item.size,drive_id:file.getId()});});}
function submit_(db,body){
 const codeName=text_(body.codeName,'Code name',1,80),category=text_(body.category,'Category',1,80),subject=text_(body.subject,'Subject',1,180),details=text_(body.details,'Concern details',1,12000),requested=text_(body.requestedAction||'','Requested outcome',0,2000);
 if(DINIG_CATEGORIES.indexOf(category)<0||body.privacy!==true||!uuid_(body.submissionKey)||body.website)fail_('VALIDATION','Review the category and privacy acknowledgment.');
 if(body.attachments&&(!Array.isArray(body.attachments)||body.attachments.length))fail_('VALIDATION','Attachments are no longer accepted with new concerns.');
 if(get_(db,'SubmissionKeys',body.submissionKey))fail_('DUPLICATE','This concern was already submitted. Use its saved tracking code.');
 const rule=get_(db,'Routing',category),conflicts=[],sensitive=!!rule.restricted;
 let reviewer=rule.reviewer_id?get_(db,'Staff',rule.reviewer_id):null;if(reviewer&&!reviewer.enabled)reviewer=null;
 const independent=s=>s.enabled&&s.sensitive_access&&['administrator','restricted_reviewer'].indexOf(s.role)!==-1&&conflicts.indexOf(s.user_id)<0;
 if(sensitive&&(!reviewer||!independent(reviewer)))reviewer=rows_(db,'Staff').find(independent)||null;
 if(sensitive&&!reviewer)fail_('NOT_CONFIGURED','An independent restricted reviewer is not currently available. Please use an approved council contact.');
 const id=Utilities.getUuid(),code=token_('tracking'),reference='DINIG-'+new Date().getUTCFullYear()+'-'+hash_(Utilities.getUuid()).slice(0,12).toUpperCase();
 if(rows_(db,'Reports').some(r=>r.reference===reference))fail_('BUSY','Please retry this submission.');
 add_(db,'Reports',{id:id,reference:reference,code_name:codeName,category:category,subject:subject,details:details,incident_date:null,location:'',requested_action:requested,sensitive:sensitive,conflict_staff:conflicts,status:'Submitted',priority:'Normal',resolution:'',review_requested:false,due_at:rule.target_hours?new Date(Date.now()+rule.target_hours*3600000).toISOString():null,updated_at:now_()});
 put_(db,'Credentials',{id:id,report_id:id,code_hash:hash_(code)});put_(db,'SubmissionKeys',{id:body.submissionKey,report_id:id});add_(db,'History',{report_id:id,previous_status:null,new_status:'Submitted',actor_type:'student',actor_id:null,explanation:'Your concern has been submitted.',student_visible:true});
 if(reviewer){add_(db,'Assignments',{report_id:id,staff_id:reviewer.user_id,assigned_by:null});add_(db,'Notifications',{report_id:id,staff_id:reviewer.user_id,kind:'new_report'});}return {reference:reference,trackingCode:code};
}
function detail_(db,actor,id){
 const report=report_(db,actor,id),staff=!!actor.staffId;
 const output={report:staff?clean_(report):pick_(report,['id','reference','code_name','category','subject','details','incident_date','location','requested_action','status','resolution','review_requested','created_at','updated_at']),messages:rows_(db,'Messages').filter(m=>m.report_id===id&&(staff||!m.internal)).map(m=>pick_(m,staff?['id','body','author_type','author_id','internal','created_at']:['id','body','author_type','created_at'])),history:rows_(db,'History').filter(h=>h.report_id===id&&(staff||h.student_visible)).map(h=>pick_(h,['previous_status','new_status','explanation','created_at','actor_type'])),attachments:rows_(db,'Attachments').filter(a=>a.report_id===id).map(a=>pick_(a,['id','name','mime','size','message_id','created_at'])),feedback:rows_(db,'Feedback').filter(f=>f.report_id===id).map(f=>pick_(f,['kind','body','created_at']))};
 if(staff){output.assignments=rows_(db,'Assignments').filter(a=>a.report_id===id).map(a=>({staff_id:a.staff_id,display_name:(get_(db,'Staff',a.staff_id)||{}).display_name||'Former handler'}));output.referrals=rows_(db,'Referrals').filter(r=>r.report_id===id).map(r=>Object.assign({},clean_(r),{office:(get_(db,'Offices',r.office_id)||{}).name||'Approved office'}));}return output;
}
function message_(db,actor,id,body){report_(db,actor,id);const content=text_(body.body,'Message',1,8000),internal=!!actor.staffId&&body.internal===true,files=validateFiles_(body.attachments);if(internal&&files.length)fail_('VALIDATION','Private notes cannot include student-accessible attachments.');const row=add_(db,'Messages',{report_id:id,author_id:actor.staffId||null,author_type:actor.staffId?'staff':'student',body:content,internal:internal});saveFiles_(db,id,files,row.id);if(actor.staffId)audit_(db,actor,id,internal?'internal_note':'staff_reply');return {ok:true};}
function history_(db,actor,r,status,reason){add_(db,'History',{report_id:r.id,previous_status:r.status,new_status:status,actor_id:actor.staffId||null,actor_type:actor.staffId?'staff':'student',explanation:reason,student_visible:true});r.status=status;r.updated_at=now_();put_(db,'Reports',r);}
function feedback_(db,actor,body){const r=report_(db,actor,actor.reportId),kind=body.kind;if(['confirmed','feedback','review_request'].indexOf(kind)<0||['Resolved','Closed'].indexOf(r.status)<0)fail_('VALIDATION','Outcome responses are available after resolution.');const reason=text_(body.body||'','Feedback / reason',kind==='review_request'?10:0,2000);if(kind==='review_request'){
 if(r.review_requested)fail_('DUPLICATE','A further-review request is already pending.');
 const prior=rows_(db,'Assignments').filter(a=>a.report_id===r.id).map(a=>a.staff_id).concat(rows_(db,'Messages').filter(m=>m.report_id===r.id&&m.author_id).map(m=>m.author_id),rows_(db,'History').filter(h=>h.report_id===r.id&&h.actor_id).map(h=>h.actor_id));
 const reviewer=rows_(db,'Staff').find(s=>s.enabled&&s.sensitive_access&&['administrator','restricted_reviewer'].indexOf(s.role)!==-1&&(r.conflict_staff||[]).indexOf(s.user_id)<0&&prior.indexOf(s.user_id)<0);if(!reviewer)fail_('NOT_CONFIGURED','An independent reviewer is not currently configured. Please use an approved council contact.');
 add_(db,'Assignments',{report_id:r.id,staff_id:reviewer.user_id,assigned_by:null});add_(db,'Notifications',{report_id:r.id,staff_id:reviewer.user_id,kind:'further_review'});r.review_requested=true;r.updated_at=now_();put_(db,'Reports',r);
 }else if(kind==='confirmed'&&r.status==='Resolved')history_(db,actor,r,'Closed','The student confirmed resolution.');add_(db,'Feedback',{report_id:r.id,kind:kind,body:reason});return {ok:true};}

function staffAction_(db,actor,id,body){
 const r=report_(db,actor,id),reason=text_(body.reason||'','Explanation',1,4000),admin=actor.profile.role==='administrator';
 if(r.review_requested&&['status','refer'].indexOf(body.action)!==-1){const review=rows_(db,'Notifications').some(n=>n.report_id===id&&n.staff_id===actor.staffId&&n.kind==='further_review');if(!review||!actor.profile.sensitive_access||['administrator','restricted_reviewer'].indexOf(actor.profile.role)<0)fail_('FORBIDDEN','This request must be handled by its independent reviewer.');}
 if(body.action==='status'){
 const transitions={Submitted:['Under Review','In Progress','Awaiting Student Response'],'Under Review':['In Progress','Awaiting Student Response','Resolved','Closed'],'Awaiting Student Response':['Under Review','In Progress','Resolved','Closed'],'In Progress':['Under Review','Awaiting Student Response','Resolved','Closed'],Referred:['Under Review','In Progress','Awaiting Student Response','Resolved','Closed'],Resolved:['Closed'].concat(r.review_requested?['Under Review']:[]),Closed:r.review_requested?['Under Review']:[]};
 if(!transitions[r.status]||transitions[r.status].indexOf(body.status)<0)fail_('VALIDATION','This status change is not available from the current status.');
 if(['Resolved','Closed'].indexOf(body.status)!==-1)r.resolution=reason;if(body.status==='Under Review')r.review_requested=false;history_(db,actor,r,body.status,reason);
 }else if(body.action==='assign'){
 if(!admin)fail_('FORBIDDEN','Only administrators can assign handlers.');const staff=get_(db,'Staff',body.staffId);
 if(!staff||!staff.enabled||(r.conflict_staff||[]).indexOf(staff.user_id)!==-1||(r.sensitive&&(!staff.sensitive_access||['administrator','restricted_reviewer'].indexOf(staff.role)<0)))fail_('VALIDATION','Choose an independent authorized handler.');
 if(body.replace===true)rows_(db,'Assignments').filter(a=>a.report_id===id).forEach(a=>remove_(db,'Assignments',a.id));
 if(!rows_(db,'Assignments').some(a=>a.report_id===id&&a.staff_id===staff.user_id))add_(db,'Assignments',{report_id:id,staff_id:staff.user_id,assigned_by:actor.staffId});add_(db,'Notifications',{report_id:id,staff_id:staff.user_id,kind:'assignment'});
 }else if(body.action==='metadata'){
 if(DINIG_CATEGORIES.indexOf(body.category)<0||['Low','Normal','High','Urgent'].indexOf(body.priority)<0)fail_('VALIDATION','Choose a valid category and priority.');if(get_(db,'Routing',body.category).restricted&&!r.sensitive)fail_('VALIDATION','Restrict and independently reassign this report before moving it to that category.');r.category=body.category;r.priority=body.priority;r.updated_at=now_();put_(db,'Reports',r);
 }else if(body.action==='restrict'){
 if(!admin)fail_('FORBIDDEN','Administrator access is required.');if(!Array.isArray(body.conflictStaff)||body.conflictStaff.some(x=>!uuid_(x)))fail_('VALIDATION','Choose valid staff conflicts.');const reviewer=get_(db,'Staff',body.reviewerId);
 if(!reviewer||!reviewer.enabled||!reviewer.sensitive_access||['administrator','restricted_reviewer'].indexOf(reviewer.role)<0||body.conflictStaff.indexOf(reviewer.user_id)!==-1||reviewer.user_id===actor.staffId)fail_('VALIDATION','Choose an independent authorized reviewer.');
 rows_(db,'Assignments').filter(a=>a.report_id===id).forEach(a=>remove_(db,'Assignments',a.id));add_(db,'Assignments',{report_id:id,staff_id:reviewer.user_id,assigned_by:actor.staffId});add_(db,'Notifications',{report_id:id,staff_id:reviewer.user_id,kind:'restricted_assignment'});r.sensitive=true;r.conflict_staff=body.conflictStaff;r.updated_at=now_();put_(db,'Reports',r);
 }else if(body.action==='refer'){
 if(['Resolved','Closed'].indexOf(r.status)!==-1)fail_('VALIDATION','Reopen an authorized further-review request before referring this report.');const office=get_(db,'Offices',body.officeId);if(!office||office.enabled===false)fail_('VALIDATION','Choose a university-approved office.');const explanation=text_(body.publicExplanation,'Student-visible explanation',1,2000);add_(db,'Referrals',{report_id:id,office_id:office.id,follow_up:reason,outcome:'',updated_at:now_()});history_(db,actor,r,'Referred',explanation);
 }else if(body.action==='referral_outcome'){
 const referral=get_(db,'Referrals',body.referralId);if(!referral||referral.report_id!==id)fail_('NOT_FOUND','Referral not found.');referral.outcome=reason;referral.updated_at=now_();put_(db,'Referrals',referral);
 }else fail_('INVALID_ACTION','Unknown staff action.');audit_(db,actor,id,body.action);return {ok:true};
}
function parameters_(path){const result={},query=path.split('?')[1]||'';query.split('&').filter(Boolean).forEach(pair=>{const i=pair.indexOf('=');try{result[decodeURIComponent(i<0?pair:pair.slice(0,i))]=decodeURIComponent((i<0?'':pair.slice(i+1)).replace(/\+/g,' '));}catch(ignore){fail_('VALIDATION','Invalid filter.');}});return result;}
function list_(db,actor,path){
 const query=parameters_(path),search=(query.q||'').toLowerCase();if(search.length>180)fail_('VALIDATION','Search must be at most 180 characters.');
 ['from','to'].forEach(k=>{if(query[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(query[k])||isNaN(Date.parse(query[k]))))fail_('VALIDATION','Enter a valid date filter.');});
 let reports=rows_(db,'Reports').filter(r=>allowed_(db,actor,r));
 reports=reports.filter(r=>['category','status','priority'].every(k=>!query[k]||r[k]===query[k])&&(!query.from||r.created_at.slice(0,10)>=query.from)&&(!query.to||r.created_at.slice(0,10)<=query.to)&&(!search||[r.reference,r.subject,r.code_name].some(s=>s.toLowerCase().indexOf(search)!==-1)));
 const assignments=rows_(db,'Assignments');if(query.handler)reports=reports.filter(r=>assignments.some(a=>a.report_id===r.id&&a.staff_id===query.handler));
 if(query.queue==='unassigned')reports=reports.filter(r=>!assignments.some(a=>a.report_id===r.id));
 if(query.queue==='mine')reports=reports.filter(r=>assignments.some(a=>a.report_id===r.id&&a.staff_id===actor.staffId));
 if(query.queue==='overdue')reports=reports.filter(r=>r.due_at&&r.due_at<now_()&&['Resolved','Closed'].indexOf(r.status)<0);
 if(query.queue==='review')reports=reports.filter(r=>r.review_requested);
 const offset=Math.max(0,Math.min(100000,Number(query.offset)||0));reports.sort((a,b)=>b.created_at.localeCompare(a.created_at));
 return {reports:reports.slice(offset,offset+50).map(r=>pick_(r,['id','reference','subject','code_name','category','status','priority','created_at','due_at','review_requested','sensitive']))};
}
function settings_(db,actor,body){
 if(actor.profile.role!=='administrator')fail_('FORBIDDEN','Administrator access is required.');
 if(body.type==='staff'){
 const email=text_(body.email,'Staff email',3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||['administrator','handler','restricted_reviewer'].indexOf(body.role)<0||email===actor.profile.email)fail_('VALIDATION','Enter another staff email and a valid role.');
 if(body.sensitiveAccess&&body.role==='handler')fail_('VALIDATION','Restricted access requires a reviewer or administrator role.');
 const old=rows_(db,'Staff').find(s=>s.email===email),id=old?old.id:Utilities.getUuid();
 const password=body.password||'',credentials=password||!old?passwordRecord_(password):pick_(old,['password_scheme','password_hash','password_salt','password_iterations','auth_version']);
 put_(db,'Staff',Object.assign({id:id,user_id:id,public_id:old?old.public_id:Utilities.getUuid(),email:email,display_name:text_(body.name,'Staff name',1,100),role:body.role,enabled:body.enabled===true,sensitive_access:body.sensitiveAccess===true,created_at:old?old.created_at:now_()},credentials));
 }else if(body.type==='office'){
 const name=text_(body.name,'Approved office',1,160),old=rows_(db,'Offices').find(o=>o.name===name);if(old){old.enabled=true;put_(db,'Offices',old);}else add_(db,'Offices',{name:name,enabled:true});
 }else if(body.type==='routing'){
 if(DINIG_CATEGORIES.indexOf(body.category)<0||body.targetHours!==null&&(!Number.isInteger(body.targetHours)||body.targetHours<1||body.targetHours>8760))fail_('VALIDATION','Choose a category and valid target hours.');
 const reviewer=body.reviewerId?get_(db,'Staff',body.reviewerId):null;if(body.reviewerId&&(!reviewer||!reviewer.enabled))fail_('VALIDATION','Choose an enabled handler.');if(body.restricted&&(!reviewer||!reviewer.sensitive_access||['administrator','restricted_reviewer'].indexOf(reviewer.role)<0))fail_('VALIDATION','Restricted routing requires an authorized reviewer.');put_(db,'Routing',{id:body.category,category:body.category,restricted:body.restricted===true,reviewer_id:body.reviewerId||null,target_hours:body.targetHours});
 }else fail_('INVALID_ACTION','Unknown setting.');audit_(db,actor,null,'settings_'+body.type);if(body.type==='staff')PropertiesService.getScriptProperties().deleteProperty('FAST_ADMIN_RECORD');return {ok:true};
}
