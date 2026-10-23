import fs from 'node:fs/promises';
import {loginView} from '../public/login-view.js';
const root=new URL('../',import.meta.url);
const template=await fs.readFile(new URL('public/index.html',root),'utf8');
for(const base of ['', 'docs/']){
 await fs.mkdir(new URL(base+'staff/',root),{recursive:true});
 for(const staff of [false,true]){
  const prefix=staff?'../':'./';let html=template.replaceAll('href="/assets/',`href="${prefix}assets/`).replaceAll('src="/assets/',`src="${prefix}assets/`).replace('href="/csc-header.css"',`href="${prefix}csc-header.css"`).replace('href="/styles.css"',`href="${prefix}styles.css"`).replace('src="/app.js"',`src="${prefix}app.js"`).replace('data-entry="students"',`data-entry="${staff?'staff':'students'}"`);
  if(staff){
   const dashboardUrl='https://centralstudentcouncil2026-rgb.github.io/CSC-SYNC-Admin/csc-officers.html';
   html=html.replace('https://centralstudentcouncil2026-rgb.github.io/CSC-Websites/',dashboardUrl);
   // Render the login in the delivered HTML, before the module initializes.
   // Inert prevents native form submission (and credential URLs) before binding.
   const view=loginView({dashboardUrl,logo:prefix+'assets/csc-torch.png',errorBox:'<p class="form-error" role="alert" tabindex="-1"></p>'}).replace('<form class="dinig-login-form">','<form class="dinig-login-form" inert>');
   html=html.replace('<p class="loading" role="status">Opening D.I.N.I.G.…</p>',view+'<noscript><p class="form-error">Enable JavaScript to sign in.</p></noscript>');
  }
  await fs.writeFile(new URL(base+(staff?'staff/index.html':'index.html'),root),html);
 }
 for(const file of ['app.js','login-view.js','backend.js','backend-config.js','csc-header.css'])await fs.copyFile(new URL('public/'+file,root),new URL(base+file,root));
 const css=(await fs.readFile(new URL('public/styles.css',root),'utf8')).replaceAll("url('/assets/","url('./assets/");await fs.writeFile(new URL(base+'styles.css',root),css);
 await fs.cp(new URL('public/assets/',root),new URL(base+'assets/',root),{recursive:true});
 await fs.writeFile(new URL(base+'.nojekyll',root),'');
}
console.log('Built static HTML student/staff entries and the /docs GitHub Pages bundle.');
