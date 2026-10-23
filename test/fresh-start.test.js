import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createHarness} from './sheets-harness.js';
const h=createHarness({source:'FreshStart.gs',crypto:false,noSecret:true});
const credentials={email:'aupcscdinig@aup.edu.ph',password:'Test-only initial password 2026!'};
let admin,student,reportId;
test('fresh bound setup needs no crypto library and automatically prepares one admin',()=>{
 assert.equal(h.context.DinigCrypto,undefined);assert.match(h.props.get('TOKEN_SECRET'),/^[a-f\d]{64}$/);assert.equal(h.props.has('ADMIN_PASSWORD'),false);assert(h.props.has('FAST_ADMIN_RECORD'));assert.equal(h.rows('Staff').length,1);
 const health=JSON.parse(h.context.doGet({parameter:{action:'health'}}).text).data;assert.equal(health.fastAdminReady,true);assert.equal(health.backendVersion,'dinig-fresh-single-admin-v1');
});
test('fresh login reads no Sheet and creates only a cached session',()=>{
 const open=h.context.SpreadsheetApp.openById;h.context.SpreadsheetApp.openById=()=>{throw Error('Unexpected spreadsheet read');};
 const result=h.request('/staff/login',credentials);assert(result.ok,result.error);assert.equal(result.data.fastLogin,true);admin={staffToken:result.data.staffToken};assert.equal(h.rows('Sessions').length,0);
 assert.equal(h.request('/staff/login',{...credentials,password:'incorrect'}).code,'UNAUTHORIZED');h.context.SpreadsheetApp.openById=open;
 assert(h.request('/staff/startup',{},admin).ok);const options=h.request('/staff/options',{},admin);assert.equal(options.data.singleAdmin,true);assert.equal(h.request('/staff/settings',{type:'staff',email:'other@example.invalid'},admin).code,'FORBIDDEN');
});
test('fresh student submission, tracking scope, replies and status match the HTML app',()=>{
 const input={submissionKey:crypto.randomUUID(),codeName:'Student',category:'Academic',subject:'Fresh database test',details:'Please review.',requestedAction:'Please follow up.',privacy:true};
 const submitted=h.request('/reports',input);assert(submitted.ok,submitted.error);const tracked=h.request('/track',{code:submitted.data.trackingCode});assert(tracked.ok);student={studentToken:tracked.data.studentToken};const report=h.request('/student/report',{},student);reportId=report.data.report.id;assert.equal(report.data.report.requested_action,'Please follow up.');
 assert.equal(h.request('/staff/reports/'+reportId,{},student).code,'UNAUTHORIZED');assert(h.request('/staff/reports/'+reportId+'/message',{body:'Internal test',internal:true},admin).ok);assert(!JSON.stringify(h.request('/student/report',{},student)).includes('Internal test'));
 assert(h.request('/staff/reports/'+reportId+'/action',{action:'status',status:'Under Review',reason:'Reviewing.'},admin).ok);assert.equal(h.request('/student/report',{},student).data.report.status,'Under Review');
});
test('fresh reset revokes old sessions and setup never deletes reports',()=>{
 h.context.setup();assert.equal(h.rows('Reports').length,1);assert.equal(h.rows('Staff').length,1);h.props.set('ADMIN_PASSWORD','A newly chosen test password!');h.context.resetAdminPassword();assert.equal(h.props.has('ADMIN_PASSWORD'),false);
 assert.equal(h.request('/staff/startup',{},admin).code,'UNAUTHORIZED');assert.equal(h.request('/staff/login',credentials).code,'UNAUTHORIZED');assert(h.request('/staff/login',{...credentials,password:'A newly chosen test password!'}).ok);
});
