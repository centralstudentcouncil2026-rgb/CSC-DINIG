import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('./apps-script-crypto-entry.js',import.meta.url))],bundle:true,format:'iife',globalName:'DinigCrypto',platform:'neutral',target:'es2019',outfile:fileURLToPath(new URL('../google-apps-script/Crypto.gs',import.meta.url)),legalComments:'inline'});
await fs.copyFile(new URL('../node_modules/@noble/hashes/LICENSE',import.meta.url),new URL('../google-apps-script/NOBLE-LICENSE.txt',import.meta.url));
console.log('Bundled offline password hashing for Apps Script.');
