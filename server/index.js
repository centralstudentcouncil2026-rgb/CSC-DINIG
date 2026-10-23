import http from 'node:http';
import pg from 'pg';
import {configuration,databaseOptions} from './config.js';
import {createApp} from './app.js';
const config=configuration();const pool=new pg.Pool(databaseOptions());
const server=http.createServer(createApp({pool,config}));
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('CSC D.I.N.I.G. server started.'));
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>server.close(async()=>{await pool.end();process.exit(0);}));
