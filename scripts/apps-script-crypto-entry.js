import {pbkdf2} from '@noble/hashes/pbkdf2';
import {sha256} from '@noble/hashes/sha256';
// Apps Script has Utilities but no browser TextEncoder dependency is assumed.
function bytes(text){return Uint8Array.from(Utilities.newBlob(text).getBytes(),value=>(value+256)%256);}
export function derive(password,salt,iterations){return Array.from(pbkdf2(sha256,bytes(password),bytes(salt),{c:iterations,dkLen:32}),value=>value.toString(16).padStart(2,'0')).join('');}
