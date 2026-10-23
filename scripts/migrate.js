import fs from 'node:fs/promises';
import pg from 'pg';
import { databaseOptions } from '../server/config.js';
const client=new pg.Client(databaseOptions());
try { await client.connect(); await client.query(await fs.readFile(new URL('../migrations/001_dinig.sql',import.meta.url),'utf8')); console.log('D.I.N.I.G. schema installed. Provision the first authorized staff account as described in README.md.'); }
finally { await client.end(); }
