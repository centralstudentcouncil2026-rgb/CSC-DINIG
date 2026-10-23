import {backendUrl} from './backend-config.js';
const staffSessionKey='csc-dinig:staff-session:v1';
let studentToken='',staffToken='';
function rememberStaff(token){staffToken=token||'';try{if(staffToken)sessionStorage.setItem(staffSessionKey,JSON.stringify({backendUrl,token:staffToken}));else sessionStorage.removeItem(staffSessionKey);}catch{/* Storage may be unavailable; the current memory session still works. */}}
try{const saved=JSON.parse(sessionStorage.getItem(staffSessionKey)||'null');if(saved?.backendUrl===backendUrl&&/^[\w-]{43}$/.test(saved.token))staffToken=saved.token;else sessionStorage.removeItem(staffSessionKey);}catch{try{sessionStorage.removeItem(staffSessionKey);}catch{}}

const categories=['Academic','Facilities','Student Services','Safety and Welfare','Organizations','Ideas and Suggestions','Others'];
const statuses=['Submitted','Under Review','Awaiting Student Response','In Progress','Referred','Resolved','Closed'];
export const isConfigured=()=>/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(backendUrl);
export const hasSession=()=>Boolean(studentToken||staffToken);
export const guestContext=()=>({csrf:'',student:false,staff:null,categories:[...categories],statuses:[...statuses],routingStaff:[],emergencyGuidance:'',responseGuidance:''});
export async function request(path,body){
 if(!isConfigured()){
  if(path==='/session')return {csrf:'',student:false,staff:null,categories,statuses,routingStaff:[],emergencyGuidance:'',responseGuidance:''};
  throw Error('The council is connecting this service. Please wait for its launch announcement.');
 }
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch(backendUrl,{method:'POST',credentials:'omit',redirect:'follow',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({path,body:body||{},studentToken,staffToken})});
  let result;try{result=await response.json();}catch{throw Error('The service did not return a valid response. Please try again later.');}
  if(!response.ok||!result.ok){if(result.code==='UNAUTHORIZED'){if(path.startsWith('/staff/')||path==='/session')rememberStaff('');else if(path.startsWith('/student/'))studentToken='';}throw Error(result.error||'The request could not be completed.');}
  const data=result.data||{};
  if(path==='/track'){studentToken=data.studentToken;return {ok:true};}
  if(path==='/staff/login'){rememberStaff(data.staffToken);return {ok:true,bootstrap:data.bootstrap||null,fastLogin:data.fastLogin===true};}
  if(path==='/student/logout')studentToken='';if(path==='/staff/logout')rememberStaff('');
  if(path==='/session'){if(!data.student)studentToken='';if(!data.staff)rememberStaff('');}
  return data;
 }catch(error){if(error.name==='AbortError')throw Error('The update could not be confirmed. Check its status before retrying.');if(error instanceof TypeError)throw Error('Cannot reach the service. Check your connection and try again.');throw error;}
 finally{clearTimeout(timer);if(path==='/student/logout')studentToken='';if(path==='/staff/logout')rememberStaff('');}
}
