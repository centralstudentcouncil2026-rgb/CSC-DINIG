import {existsSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
export function databaseOptions(env=process.env) {
 return {connectionString:env.DATABASE_URL, ...(env.DATABASE_SSL==='true'?{ssl:{rejectUnauthorized:true}}:{}),max:8};
}
export function configuration(env=process.env) {
 const origin=env.APP_ORIGIN||'http://127.0.0.1:3000';
 const local=['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname);
 if(new URL(origin).origin!==origin) throw Error('APP_ORIGIN must be an origin without a path or trailing slash');
 if(!origin.startsWith('https://') && !(local && env.NODE_ENV!=='production')) throw Error('HTTPS is required outside local development');
 if(!/^[a-f0-9]{64,}$/i.test(env.RATE_LIMIT_SECRET||'')) throw Error('Set RATE_LIMIT_SECRET to at least 32 random bytes encoded as hex');
 if(!env.DATABASE_URL || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw Error('Configure DATABASE_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
 if(!env.SUPABASE_URL.startsWith('https://'))throw Error('SUPABASE_URL must use HTTPS');
 const retentionDays=Number(env.RETENTION_DAYS||365);
 if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>36500)throw Error('RETENTION_DAYS must be a whole number from 1 to 36500');
 return {origin,secure:origin.startsWith('https:'),supabase:env.SUPABASE_URL.replace(/\/$/,''),publishableKey:env.SUPABASE_PUBLISHABLE_KEY,
 rateSecret:env.RATE_LIMIT_SECRET,trustProxy:env.TRUST_PROXY==='true', emergencyGuidance:env.EMERGENCY_GUIDANCE||'',responseGuidance:env.RESPONSE_GUIDANCE||'',retentionDays};
}
