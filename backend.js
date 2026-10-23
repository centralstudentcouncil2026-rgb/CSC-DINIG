import {backendUrl} from './backend-config.js';
let studentToken='',staffToken='';
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
  if(!response.ok||!result.ok){if(result.code==='UNAUTHORIZED'){if(path.startsWith('/staff/'))staffToken='';else if(path.startsWith('/student/'))studentToken='';}throw Error(result.error||'The request could not be completed.');}
  const data=result.data||{};
  if(path==='/track'){studentToken=data.studentToken;return {ok:true};}
  if(path==='/staff/login'){staffToken=data.staffToken;return {ok:true,bootstrap:data.bootstrap||null,fastLogin:data.fastLogin===true};}
  if(path==='/student/logout')studentToken='';if(path==='/staff/logout')staffToken='';
  if(path==='/session'){if(!data.student)studentToken='';if(!data.staff)staffToken='';}
  return data;
 }catch(error){if(error.name==='AbortError')throw Error('The update could not be confirmed. Check its status before retrying.');if(error instanceof TypeError)throw Error('Cannot reach the service. Check your connection and try again.');throw error;}
 finally{clearTimeout(timer);if(path==='/student/logout')studentToken='';if(path==='/staff/logout')staffToken='';}
}
export async function downloadAttachment(kind,id){
 if(!['student','staff'].includes(kind)||! /^[a-f\d-]{36}$/i.test(id))throw Error('Attachment not found.');
 const file=await request(`/${kind}/attachments/${id}`),bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
