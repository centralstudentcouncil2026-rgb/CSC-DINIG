import pg from 'pg';
import {databaseOptions,configuration} from '../server/config.js';
const missing=[];
for(const name of ['DATABASE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','RATE_LIMIT_SECRET'])if(!process.env[name]||/REPLACE_WITH|USER:PASSWORD|HOST:5432/.test(process.env[name]))missing.push(name);
if(missing.length){console.error('Required settings are missing: '+missing.join(', ')+'. Add them to the ignored .env file or your hosting secret manager.');process.exitCode=1;}
else{
 try{
  configuration();
  const url=new URL(process.env.DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname)throw Error('DATABASE_URL must be a PostgreSQL connection URI.');
  console.log('Required settings are present. Values and secrets are not displayed.');
  if(process.argv.includes('--database')){
   const client=new pg.Client({...databaseOptions(),connectionTimeoutMillis:10000});
   try{
    await client.connect();await client.query('BEGIN');await client.query('SET LOCAL ROLE dinig_runtime');
    const result=await client.query("SELECT EXISTS(SELECT 1 FROM dinig.staff_profiles WHERE enabled AND role='administrator') AS administrator_ready");
    await client.query('ROLLBACK');
    if(!result.rows[0].administrator_ready)throw Error('Authorize the first existing Supabase staff account before launch.');
    console.log('Database connection, D.I.N.I.G. runtime role, schema and administrator membership verified.');
   }finally{await client.end();}
  }else console.log('Database not contacted. Run npm run preflight -- --database after configuring the connection and applying the migration.');
 }catch(error){
  const message=error.code?'Database verification failed. Confirm the connection, TLS trust, migration and runtime-role grant.':error.message;
  console.error(message);process.exitCode=1;
 }
}
