import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
for(const staff of [false,true]){
 const prefix=staff?'../':'./',back=staff?'https://centralstudentcouncil2026-rgb.github.io/CSC-SYNC-Admin/csc-officers.html':'https://centralstudentcouncil2026-rgb.github.io/CSC-Websites/';
 const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c1665"><meta name="description" content="CSC D.I.N.I.G. — Discuss Issues, Needs, Ideas, and Grievances."><title>CSC D.I.N.I.G. | ${staff?'Administrator':'Student'} Access</title><link rel="icon" href="${prefix}public/assets/csc-torch.png"><link rel="stylesheet" href="${prefix}public/csc-header.css"><link rel="stylesheet" href="${prefix}launch.css"><script defer src="${prefix}launch.js" data-access="${staff?'staff':'student'}"></script></head>
<body><a class="skip" href="#main">Skip to content</a><header class="csc-site-header"><div class="csc-header-inner"><a class="csc-dashboard-back" data-dashboard-back href="${back}" aria-label="Back to CSC Websites">← <span>CSC Websites</span></a><div class="csc-header-brand"><img src="${prefix}public/assets/csc-torch.png" alt="CSC torch" width="26" height="39"><div><strong>CSC D.I.N.I.G.</strong><small>Discuss Issues, Needs, Ideas, and Grievances</small></div></div></div></header>
<main id="main"><section class="hero"><div class="eyebrow">${staff?'Administrator access':'Student access'}</div><h1>CSC – D.I.N.I.G.</h1><p class="meaning">Discuss Issues, Needs, Ideas, and Grievances</p><p>A space for your voice. A channel for action.</p></section>
<section class="panel" aria-labelledby="availability"><span class="status">Preparing for launch</span><h2 id="availability">${staff?'Staff sign-in':'Student access'} is not open yet.</h2><p>The council is preparing this service. Please wait for the official launch announcement.</p>${staff?'<button type="button" disabled>Staff Log In · Not yet available</button>':'<div class="actions"><button type="button" disabled>Submit a Concern · Not yet available</button><button type="button" disabled>Track My Concern · Not yet available</button></div>'}<p class="note">No concerns, attachments, or login details can be submitted on this page.</p><a data-dashboard-back href="${back}">← Return to CSC Websites</a></section>
<aside><strong>Your privacy matters.</strong> When the service opens, students will not need an account. Each concern will have its own private tracking code. This service is not continuously monitored for emergencies.</aside></main>
<footer>Central Student Council · Adventist University of the Philippines</footer></body></html>`;
 if(staff)await fs.mkdir(new URL('staff/',root),{recursive:true});
 await fs.writeFile(new URL(staff?'staff/index.html':'index.html',root),html);
}
console.log('Built static student and staff launch pages. No concern collection is enabled.');
// Publish only launch assets, keeping the private server source out of Pages.
await fs.mkdir(new URL('docs/',root),{recursive:true});
for(const name of ['index.html','staff/index.html','launch.css','launch.js','public/csc-header.css','public/assets/csc-torch.png','public/assets/campus.jpg','public/assets/inter-latin.woff2','public/assets/Inter-LICENSE.txt']){
 const destination=new URL('docs/'+name,root);await fs.mkdir(new URL('.',destination),{recursive:true});await fs.copyFile(new URL(name,root),destination);
}
await fs.writeFile(new URL('docs/.nojekyll',root),'');
