import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
import {fileURLToPath} from 'node:url';
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(['.git','node_modules','test-results'].includes(entry.name))continue;const full=path.join(dir,entry.name);if(entry.isDirectory())await walk(full);else if(/\.js$/.test(full))execFileSync(process.execPath,['--check',full],{stdio:'inherit'});else if(full.endsWith('.gs'))new vm.Script(await fs.readFile(full,'utf8'),{filename:full});}}
await walk(root);
for(const file of ['public/index.html','public/styles.css']){const content=await fs.readFile(path.join(root,file),'utf8');for(const match of content.matchAll(/(?:src|href)="(\/[^"#]+)"|url\('(\/[^']+)'\)/g)){const asset=match[1]||match[2];if(['/','/submit','/track','/staff'].includes(asset))continue;await fs.access(path.join(root,'public',asset));}}
for(const file of ['index.html','staff/index.html','styles.css','docs/index.html','docs/staff/index.html','docs/styles.css']){const full=path.join(root,file),content=await fs.readFile(full,'utf8');for(const match of content.matchAll(/(?:src|href)="(\.\.?\/[^"#]+)"|url\('(\.\/?[^']+)'\)/g)){const asset=match[1]||match[2];await fs.access(path.resolve(path.dirname(full),asset));}}
console.log('JavaScript/Apps Script syntax, static HTML entries and local assets checked.');
