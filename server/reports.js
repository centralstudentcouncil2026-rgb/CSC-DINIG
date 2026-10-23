import {randomUUID,randomBytes} from 'node:crypto';
import {fail,hash,secret,text,uuid,reportInput,attachmentsInput,statuses,categories} from './security.js';
export const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
export async function audit(db,actor,id,action){await db.query('INSERT INTO dinig.audit_events(report_id,actor_id,action) VALUES($1,$2,$3)',[id,actor.staffId||null,action]);}
export async function files(db,id,items,messageId=null){for(const f of items)await db.query('INSERT INTO dinig.report_attachments(report_id,message_id,name,mime,content,size) VALUES($1,$2,$3,$4,$5,$6)',[id,messageId,f.name,f.mime,f.bytes,f.size]);}
export async function submit(db,body){
 const v=reportInput(body),uploads=attachmentsInput(body.attachments);
 if(await one(db,'SELECT key FROM dinig.submission_keys WHERE key=$1',[v.key]))fail(409,'This concern was already submitted. Use the tracking code from its confirmation.');
 const rule=await one(db,'SELECT * FROM dinig.routing_rules WHERE category=$1',[v.category]);
 const involved=v.involvedStaff?await one(db,'SELECT user_id FROM dinig.staff_profiles WHERE public_id=$1 AND enabled',[v.involvedStaff]):null;
 if(v.involvedStaff&&!involved)fail(400,'Choose a currently available staff member.');
 const conflicts=involved?[involved.user_id]:[],sensitive=v.sensitive||rule.restricted||!!involved;
 let reviewer;
 if(rule.reviewer_id)reviewer=await one(db,'SELECT * FROM dinig.staff_profiles WHERE user_id=$1 AND enabled',[rule.reviewer_id]);
 if(sensitive&&(!reviewer?.sensitive_access||!['administrator','restricted_reviewer'].includes(reviewer.role)||conflicts.includes(reviewer.user_id)))reviewer=await one(db,"SELECT * FROM dinig.staff_profiles WHERE enabled AND sensitive_access AND role IN ('administrator','restricted_reviewer') AND NOT(user_id=ANY($1::uuid[])) ORDER BY created_at LIMIT 1",[conflicts]);
 if(sensitive&&(!reviewer?.sensitive_access||!['administrator','restricted_reviewer'].includes(reviewer.role)))fail(503,'Restricted handling is currently unavailable. Please contact an authorized council representative through an approved channel.');
 const id=randomUUID(),code=secret(),reference=`DINIG-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
 await db.query("SELECT set_config('dinig.report_id',$1,true)",[id]);
 await db.query(`INSERT INTO dinig.reports(id,reference,code_name,category,subject,details,incident_date,location,requested_action,sensitive,due_at,conflict_staff)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $11::integer IS NULL THEN NULL ELSE now()+($11::text||' hours')::interval END,$12)`,[id,reference,v.codeName,v.category,v.subject,v.details,v.incidentDate,v.location,v.requestedAction,sensitive,rule.target_hours,conflicts]);
 await db.query('INSERT INTO dinig.report_access_credentials VALUES($1,$2)',[id,hash(code)]);
 await db.query('INSERT INTO dinig.submission_keys(key,report_id) VALUES($1,$2)',[v.key,id]);
 await db.query("INSERT INTO dinig.report_status_history(report_id,new_status,actor_type,explanation) VALUES($1,'Submitted','student','Your concern has been submitted.')",[id]);
 if(reviewer){await db.query('INSERT INTO dinig.report_assignments(report_id,staff_id) VALUES($1,$2)',[id,reviewer.user_id]);await db.query("INSERT INTO dinig.notifications(report_id,staff_id,kind) VALUES($1,$2,'new_report')",[id,reviewer.user_id]);}
 await files(db,id,uploads);
 return {reference,trackingCode:code};
}
export async function detail(db,id,staff=false){
 if(!uuid(id))fail(404,'Concern not found.');
 const report=await one(db,staff?'SELECT * FROM dinig.reports WHERE id=$1':`SELECT id,reference,code_name,category,subject,details,incident_date,location,requested_action,status,resolution,review_requested,created_at,updated_at FROM dinig.reports WHERE id=$1`,[id]);
 if(!report)fail(404,'Concern not found.');
 const messages=(await db.query(`SELECT id,author_type,body,created_at${staff?',internal,author_id':''} FROM dinig.report_messages WHERE report_id=$1 ${staff?'':'AND NOT internal'} ORDER BY created_at,id`,[id])).rows;
 const history=(await db.query(`SELECT previous_status,new_status,explanation,created_at,actor_type FROM dinig.report_status_history WHERE report_id=$1 ${staff?'':'AND student_visible'} ORDER BY created_at,id`,[id])).rows;
 const attachments=(await db.query('SELECT id,name,mime,size,message_id,created_at FROM dinig.report_attachments WHERE report_id=$1 ORDER BY created_at',[id])).rows;
 const feedback=(await db.query('SELECT kind,body,created_at FROM dinig.report_feedback WHERE report_id=$1 ORDER BY created_at',[id])).rows;
 const extra=staff?{assignments:(await db.query('SELECT a.staff_id,s.display_name FROM dinig.report_assignments a JOIN dinig.staff_profiles s ON s.user_id=a.staff_id WHERE report_id=$1',[id])).rows,
 referrals:(await db.query('SELECT r.*,o.name AS office FROM dinig.report_referrals r JOIN dinig.approved_offices o ON o.id=r.office_id WHERE report_id=$1 ORDER BY created_at',[id])).rows}:{};
 return {report,messages,history,attachments,feedback,...extra};
}
export async function message(db,actor,id,body){
 await detail(db,id,!!actor.staffId);
 const content=text(body.body,'Message',1,8000),internal=!!actor.staffId&&body.internal===true;
 const uploads=attachmentsInput(body.attachments);
 if(internal&&uploads.length)fail(400,'Private notes cannot include student-accessible attachments.');
 const row=await one(db,'INSERT INTO dinig.report_messages(report_id,author_id,author_type,body,internal) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,actor.staffId||null,actor.staffId?'staff':'student',content,internal]);
 await files(db,id,uploads,row.id);
 if(actor.staffId)await audit(db,actor,id,internal?'internal_note':'staff_reply');
 return {ok:true};
}
export async function studentAction(db,actor,body){
 const {report}=await detail(db,actor.reportId),kind=body.kind;
 if(!['confirmed','feedback','review_request'].includes(kind))fail(400,'Choose an available action.');
 if(!['Resolved','Closed'].includes(report.status))fail(409,'Resolution feedback is available once a concern is resolved or closed.');
 if(kind==='review_request'&&report.review_requested)fail(409,'A further-review request is already pending.');
 const reason=text(body.body??'',kind==='review_request'?'Reason':'Feedback',kind==='review_request'?10:0,2000);
 if(kind==='review_request'){
  await db.query("SELECT set_config('dinig.creating','yes',true)");
  const reviewer=await one(db,`SELECT s.user_id FROM dinig.staff_profiles s, dinig.reports r WHERE r.id=$1 AND s.enabled AND s.sensitive_access
   AND s.role IN ('administrator','restricted_reviewer') AND NOT(s.user_id=ANY(r.conflict_staff))
   AND NOT EXISTS(SELECT 1 FROM dinig.report_assignments a WHERE a.report_id=r.id AND a.staff_id=s.user_id) ORDER BY s.created_at LIMIT 1`,[actor.reportId]);
  if(!reviewer)fail(409,'An independent reviewer is not currently configured. Please use an approved council contact.');
  await db.query("SELECT set_config('dinig.creating','yes',true)");
  await db.query('INSERT INTO dinig.report_assignments(report_id,staff_id) VALUES($1,$2)',[actor.reportId,reviewer.user_id]);
  await db.query("INSERT INTO dinig.notifications(report_id,staff_id,kind) VALUES($1,$2,'further_review')",[actor.reportId,reviewer.user_id]);
  await db.query('UPDATE dinig.reports SET review_requested=true,updated_at=now() WHERE id=$1',[actor.reportId]);
 }else if(kind==='confirmed'&&report.status==='Resolved'){
  await db.query("UPDATE dinig.reports SET status='Closed',updated_at=now() WHERE id=$1",[actor.reportId]);
  await db.query("INSERT INTO dinig.report_status_history(report_id,previous_status,new_status,actor_type,explanation) VALUES($1,'Resolved','Closed','student','The student confirmed resolution.')",[actor.reportId]);
 }
 await db.query('INSERT INTO dinig.report_feedback(report_id,kind,body) VALUES($1,$2,$3)',[actor.reportId,kind,reason]);return {ok:true};
}
export async function staffAction(db,actor,id,body){
 // Lock serializes assignments and status changes, preventing lost history.
 const report=await one(db,'SELECT * FROM dinig.reports WHERE id=$1 FOR UPDATE',[id]);if(!report)fail(404,'Concern not found.');
 const reason=text(body.reason??'','Explanation',1,4000);
 if(report.review_requested&&['status','refer'].includes(body.action)){
  const assignedReview=actor.profile.sensitive_access&&['administrator','restricted_reviewer'].includes(actor.profile.role)&&await one(db,"SELECT id FROM dinig.notifications WHERE report_id=$1 AND staff_id=$2 AND kind='further_review'",[id,actor.staffId]);
  if(!assignedReview)fail(403,'This further-review request requires its independent authorized reviewer.');
 }
 if(body.action==='status'){
  if(!statuses.includes(body.status)||body.status==='Submitted')fail(400,'Choose a valid status.');
  if(body.status==='Referred')fail(400,'Record a referral to an approved office first.');
  const transitions={Submitted:['Under Review','In Progress','Awaiting Student Response'], 'Under Review':['In Progress','Awaiting Student Response','Resolved','Closed'], 'Awaiting Student Response':['Under Review','In Progress','Resolved','Closed'], 'In Progress':['Under Review','Awaiting Student Response','Resolved','Closed'], Referred:['Under Review','In Progress','Awaiting Student Response','Resolved','Closed'], Resolved:['Closed',...(report.review_requested?['Under Review']:[])], Closed:report.review_requested?['Under Review']:[]};
  if(!transitions[report.status].includes(body.status))fail(409,'This status change is not available from the current status.');
  if(report.review_requested&&body.status==='Under Review'){
   if(!actor.profile.sensitive_access||!['administrator','restricted_reviewer'].includes(actor.profile.role))fail(403,'An independent authorized reviewer must handle this request.');
   const notification=await one(db,"SELECT id FROM dinig.notifications WHERE report_id=$1 AND staff_id=$2 AND kind='further_review'",[id,actor.staffId]);
   if(!notification)fail(403,'This further-review request is assigned to another reviewer.');
  }
  await db.query('UPDATE dinig.reports SET status=$2,resolution=CASE WHEN $2 IN (\'Resolved\',\'Closed\') THEN $3 ELSE resolution END,review_requested=CASE WHEN $2=\'Under Review\' THEN false ELSE review_requested END,updated_at=now() WHERE id=$1',[id,body.status,reason]);
  await db.query('INSERT INTO dinig.report_status_history(report_id,previous_status,new_status,actor_id,actor_type,explanation) VALUES($1,$2,$3,$4,\'staff\',$5)',[id,report.status,body.status,actor.staffId,reason]);
 }else if(body.action==='assign'){
  if(actor.profile.role!=='administrator')fail(403,'Only administrators can assign handlers.');
  if(!uuid(body.staffId))fail(400,'Choose an authorized handler.');
  const staff=await one(db,'SELECT * FROM dinig.staff_profiles WHERE user_id=$1 AND enabled',[body.staffId]);
  if(!staff||report.conflict_staff.includes(body.staffId)||(report.sensitive&&(!staff.sensitive_access||!['administrator','restricted_reviewer'].includes(staff.role))))fail(400,'Choose an independent authorized handler for this concern.');
  if(body.replace===true)await db.query('DELETE FROM dinig.report_assignments WHERE report_id=$1',[id]);
  await db.query('INSERT INTO dinig.report_assignments(report_id,staff_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,body.staffId,actor.staffId]);
  await db.query("INSERT INTO dinig.notifications(report_id,staff_id,kind) VALUES($1,$2,'assignment')",[id,body.staffId]);
 }else if(body.action==='metadata'){
  if(!categories.includes(body.category)||!['Low','Normal','High','Urgent'].includes(body.priority))fail(400,'Choose a valid category and priority.');
  const rule=await one(db,'SELECT restricted FROM dinig.routing_rules WHERE category=$1',[body.category]);
  if(rule.restricted&&!report.sensitive)fail(409,'Restrict this concern and assign an independent reviewer before using that category.');
  await db.query('UPDATE dinig.reports SET category=$2,priority=$3,updated_at=now() WHERE id=$1',[id,body.category,body.priority]);
 }else if(body.action==='restrict'){
  if(actor.profile.role!=='administrator')fail(403,'An administrator must configure restricted routing.');
  if(!uuid(body.reviewerId)||!Array.isArray(body.conflictStaff)||body.conflictStaff.some(x=>!uuid(x)))fail(400,'Choose a reviewer and valid staff conflicts.');
  if(body.conflictStaff.includes(body.reviewerId)||body.reviewerId===actor.staffId)fail(400,'Choose an independent reviewer.');
  const reviewer=await one(db,"SELECT * FROM dinig.staff_profiles WHERE user_id=$1 AND enabled AND sensitive_access AND role IN ('administrator','restricted_reviewer')",[body.reviewerId]);if(!reviewer)fail(400,'Choose an authorized restricted reviewer.');
  await db.query('DELETE FROM dinig.report_assignments WHERE report_id=$1',[id]);
  await db.query('INSERT INTO dinig.report_assignments(report_id,staff_id,assigned_by) VALUES($1,$2,$3)',[id,body.reviewerId,actor.staffId]);
  await audit(db,actor,id,'restricted_routing');
  // Last operation may remove the current actor's access. Return no report data.
  await db.query('UPDATE dinig.reports SET sensitive=true,conflict_staff=$2,updated_at=now() WHERE id=$1',[id,body.conflictStaff]);
  return {ok:true};
 }else if(body.action==='refer'){
  if(['Resolved','Closed'].includes(report.status))fail(409,'Reopen a further-review request before referring a resolved concern.');
  const office=uuid(body.officeId)&&await one(db,'SELECT id FROM dinig.approved_offices WHERE id=$1 AND enabled',[body.officeId]);if(!office)fail(400,'Choose a university-approved office.');
  await db.query('INSERT INTO dinig.report_referrals(report_id,office_id,follow_up) VALUES($1,$2,$3)',[id,body.officeId,reason]);
  await db.query("UPDATE dinig.reports SET status='Referred',updated_at=now() WHERE id=$1",[id]);
  await db.query("INSERT INTO dinig.report_status_history(report_id,previous_status,new_status,actor_id,actor_type,explanation) VALUES($1,$2,'Referred',$3,'staff',$4)",[id,report.status,actor.staffId,text(body.publicExplanation,'Student-visible referral explanation',1,2000)]);
 }else if(body.action==='referral_outcome'){
  if(!uuid(body.referralId))fail(400,'Choose an existing referral.');
  const referral=await one(db,'UPDATE dinig.report_referrals SET outcome=$3,updated_at=now() WHERE id=$1 AND report_id=$2 RETURNING id',[body.referralId,id,reason]);if(!referral)fail(404,'Referral not found.');
 }else fail(400,'Unknown action.');
 await audit(db,actor,id,body.action);return {ok:true};
}
