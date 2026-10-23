import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../docs/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.txt':'text/plain'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(file!==path.resolve(root)&&!file.startsWith(root))throw Error();const target=(await fs.stat(file)).isDirectory()?path.join(file,'index.html'):file;res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(await fs.readFile(target));}catch{res.writeHead(404).end('Not found');}}).listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Static preview: http://127.0.0.1:'+(process.env.PORT||3000)));
