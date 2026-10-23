// Local QA only. This file is not included in the production Docker image.
import fs from 'node:fs/promises';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../server/app.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const pg=new PGlite();await pg.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
await pg.exec(await fs.readFile(new URL('../migrations/001_dinig.sql',import.meta.url),'utf8'));
const admin=randomUUID();await pg.query('INSERT INTO auth.users VALUES($1)',[admin]);await pg.query("INSERT INTO dinig.staff_profiles(user_id,display_name,role,sensitive_access) VALUES($1,'Test council administrator','administrator',true)",[admin]);
let queue=Promise.resolve();const pool={async connect(){let release;const next=new Promise(r=>release=r),previous=queue;queue=next;await previous;return{query:(sql,args)=>pg.query(sql,args),release};}};
const config={origin:'http://127.0.0.1',secure:false,rateSecret:'b'.repeat(64),emergencyGuidance:'',responseGuidance:'',retentionDays:365};
const server=http.createServer(createApp({pool,config,authenticate:async(email,password)=>{if(email==='qa@example.invalid'&&password==='isolated-test-only')return admin;throw Error('Invalid test identity');}}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
await fs.mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
const failures=[];
try{
 for(const viewport of [{width:1366,height:768},{width:1280,height:600},{width:768,height:1024},{width:390,height:844},{width:375,height:667}]){
  const context=await browser.newContext({viewport}),page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await pg.query('DELETE FROM dinig.rate_limits');
  for(const route of ['/','/track','/staff']){await page.goto(config.origin+route);await page.locator('.panel').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow ${route} ${viewport.width}`);}
  await page.goto(config.origin+'/submit');await page.getByLabel('Code name *').fill('QA student');await page.getByLabel('Category *').selectOption('Academic');await page.getByLabel('Subject *').fill('Accessible facilities — '+viewport.width);
  await page.getByLabel('Concern details *').fill('<script>window.BAD=true</script> Text should remain harmless.');await page.getByLabel('I understand that report content').check();
  await page.getByRole('button',{name:'Review concern'}).click();await page.getByRole('heading',{name:'Review your concern'}).waitFor();assert.equal(await page.evaluate(()=>window.BAD),undefined);
  await page.getByRole('button',{name:'Submit concern',exact:true}).click();await page.locator('#tracking-code').waitFor();const code=await page.locator('#tracking-code').textContent();assert.match(code,/^[\w-]{32}$/);
  await page.getByLabel('I have saved my private tracking code').check();await page.getByRole('button',{name:'Open my concern'}).click();await page.getByRole('heading',{name:'Original concern'}).waitFor();assert(!page.url().includes(code));
  await page.getByLabel('Add a reply').fill('A follow-up from mobile/desktop.');await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.getByText('A follow-up from mobile/desktop.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.BAD),undefined);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.reload();await page.getByRole('heading',{name:'Original concern'}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL(`../test-results/student-${viewport.width}.png`,import.meta.url)),fullPage:true});
  await page.getByRole('button',{name:'Leave Tracking Session'}).click();await page.getByRole('heading',{name:'Track my concern'}).waitFor();
  await page.goto(config.origin+'/staff');await page.getByLabel('Email address').fill('qa@example.invalid');await page.getByLabel('Password',{exact:true}).fill('isolated-test-only');await page.getByRole('button',{name:'Staff Log In'}).click();await page.getByRole('heading',{name:'Concern desk'}).waitFor();
  await page.getByRole('link').filter({hasText:'Accessible facilities — '+viewport.width}).first().click();await page.getByLabel('Reply or private note').fill('Internal test note');await page.getByLabel('Private staff note').check();await page.getByRole('button',{name:'Send message / save note'}).click();await page.getByText('Internal test note',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:fileURLToPath(new URL(`../test-results/staff-${viewport.width}.png`,import.meta.url)),fullPage:true});
  await page.goto(config.origin+'/');await page.getByRole('heading',{name:'CSC – D.I.N.I.G.'}).waitFor();await page.screenshot({path:fileURLToPath(new URL(`../test-results/home-${viewport.width}.png`,import.meta.url)),fullPage:true});
  assert.deepEqual(errors,[],`Browser errors ${viewport.width}`);await context.close();console.log(`Passed desktop/mobile submission, tracking, reload, messaging, staff access and layout: ${viewport.width}×${viewport.height}`);
 }
}catch(error){failures.push(error);throw error;}finally{await browser.close();await new Promise(r=>server.close(r));await pg.close();}
