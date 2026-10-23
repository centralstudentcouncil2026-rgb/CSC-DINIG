import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
export const categories=['Academic','Facilities','Student Services','Safety and Welfare','Organizations','Ideas and Suggestions','Others'];
export const statuses=['Submitted','Under Review','Awaiting Student Response','In Progress','Referred','Resolved','Closed'];
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const fail=(status,message)=>{throw new HttpError(status,message);};
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const secret=()=>randomBytes(24).toString('base64url');
export const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
export function text(value,name,min,max) { if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||value.includes('\0'))fail(400,`${name} must contain ${min}–${max} characters.`);return value.trim(); }
export function reportInput(body) {
 const category=text(body.category,'Category',1,80); if(!categories.includes(category))fail(400,'Choose an available category.');
 const incidentDate=body.incidentDate||null;
 if(incidentDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)||!Number.isFinite(Date.parse(incidentDate))||new Date(incidentDate).toISOString().slice(0,10)!==incidentDate||incidentDate>new Date().toISOString().slice(0,10)))fail(400,'Enter a valid incident date that is not in the future.');
 if(body.privacy!==true)fail(400,'Please acknowledge the privacy information.');
 if(!uuid(body.submissionKey))fail(400,'The submission identifier is missing. Reload the form.');
 if(body.involvedStaff&&!uuid(body.involvedStaff))fail(400,'Choose a staff member from the available list.');
 if(body.website)fail(400,'The submission could not be accepted.');
 return {codeName:text(body.codeName,'Code name',1,80),category,subject:text(body.subject,'Subject',1,180),details:text(body.details,'Concern details',1,12000),incidentDate,
 location:text(body.location??'','Location',0,200),requestedAction:text(body.requestedAction??'','Requested outcome',0,2000),sensitive:body.sensitive===true,involvedStaff:body.involvedStaff||null,key:body.submissionKey};
}
export function attachmentsInput(items=[]) {
 if(!Array.isArray(items)||items.length>3)fail(400,'Attach up to three files.');
 let total=0;
 return items.map(file=>{
  const name=text(file.name,'File name',1,120).replace(/[\x00-\x1f\x7f/\\]/g,'_');
  if(typeof file.data!=='string'||file.data.length>6990512||! /^[A-Za-z0-9+/]*={0,2}$/.test(file.data))fail(400,'Invalid attachment.');
  const bytes=Buffer.from(file.data,'base64');total+=bytes.length;
  if(!bytes.length||bytes.length>5*1024*1024||total>10*1024*1024)fail(400,'Each file must be at most 5 MB; combined files at most 10 MB.');
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':null;
  const ext=name.split('.').pop().toLowerCase();
  if(!mime||!({'image/png':['png'],'image/jpeg':['jpg','jpeg'],'application/pdf':['pdf']}[mime].includes(ext)))fail(400,'Only matching PNG, JPEG, or PDF files are supported.');
  return {name,mime,bytes,size:bytes.length};
 });
}
export function cookies(req) {const result={};for(const part of (req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)result[part.slice(0,i).trim()]=part.slice(i+1);}return result;}
export function cookieName(config,kind) {return `${config.secure?'__Host-':''}dinig-${kind}`;}
export function cookie(config,kind,value,maxAge) {return `${cookieName(config,kind)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secure?'; Secure':''}`;}
export function csrf(req,config) {
 if(req.headers.origin!==config.origin)fail(403,'Refresh this page and try again.');
 const a=cookies(req)[cookieName(config,'csrf')]||'',b=req.headers['x-csrf-token']||'';
 if(!/^[\w-]{32}$/.test(a)||typeof b!=='string'||a.length!==b.length||!timingSafeEqual(Buffer.from(a),Buffer.from(b)))fail(403,'Refresh this page and try again.');
}
export function rateKey(req,config,action) {
 const ip=config.trustProxy?(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
 return createHmac('sha256',config.rateSecret).update(`${action}:${ip}`).digest('hex');
}
export async function readJSON(req,maxBytes=15*1024*1024) {
 if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Send a JSON request.');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>maxBytes)fail(413,'The request is too large.');chunks.push(chunk);}
 try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||Array.isArray(body)||typeof body!=='object')throw Error();return body;}catch{fail(400,'The request could not be read.');}
}
