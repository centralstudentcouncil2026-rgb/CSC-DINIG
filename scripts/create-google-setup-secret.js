import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const target=new URL('../google-apps-script/.setup-secrets.txt',import.meta.url);
if(fs.existsSync(target))console.log('Existing ignored Google setup secret preserved.');
else{fs.writeFileSync(target,'TOKEN_SECRET='+randomBytes(32).toString('hex')+'\n',{mode:0o600});console.log('Created google-apps-script/.setup-secrets.txt locally. It is ignored by Git. Copy its value into Script properties; do not paste it into chat.');}
