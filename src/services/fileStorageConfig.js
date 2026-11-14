'use strict';
const crypto=require('crypto');
const settings=require('./settings');
const {badRequest}=require('../middleware/errorHandler');
const defaults={provider:'database',folder:'',enabled:true,maxMB:5,dailyMB:200,images:{maxEdge:1600,quality:0.82},s3:{endpoint:'',region:'us-east-1',bucket:'',accessKeyId:'',secretAccessKey:'',pathStyle:true,prefix:''},supabase:{url:'',bucket:'vmtl-files',serviceKey:''}};
function key(){const secret=process.env.DATABASE_PROFILE_ENCRYPTION_KEY||process.env.SESSION_SECRET;if(!secret) throw badRequest('Set DATABASE_PROFILE_ENCRYPTION_KEY or SESSION_SECRET before saving remote storage credentials.');return crypto.scryptSync(secret,'vmtl-file-server',32);}
function encrypt(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);const bytes=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
function decrypt(value){const bytes=Buffer.from(value,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8'));}
async function current(){const s=JSON.parse(await settings.get('fleet_file_server','{}'));const c={...defaults,...s,s3:{...defaults.s3,...s.s3},supabase:{...defaults.supabase,...s.supabase},images:{...defaults.images,...s.images}};if(c.secret) Object.assign(c,decrypt(c.secret));delete c.secret;return c;}
function publicConfig(c){return {...c,s3:{...c.s3,secretAccessKey:'',hasSecret:!!c.s3.secretAccessKey},supabase:{...c.supabase,serviceKey:'',hasSecret:!!c.supabase.serviceKey}};}
async function merge(input){const before=await current();return {...before,...input,s3:{...before.s3,...input.s3,secretAccessKey:input.s3?.secretAccessKey||before.s3.secretAccessKey},supabase:{...before.supabase,...input.supabase,serviceKey:input.supabase?.serviceKey||before.supabase.serviceKey},images:{...before.images,...input.images}};}
async function save(c){const copy=publicConfig(c);delete copy.s3.hasSecret;delete copy.supabase.hasSecret;if(c.s3.secretAccessKey||c.supabase.serviceKey) copy.secret=encrypt({s3:c.s3,supabase:c.supabase});await settings.set('fleet_file_server',JSON.stringify(copy));}
function adapter(c){return require('./fileStorageAdapters').adapterFor({...c,folder:{path:c.folder}},c.provider);}
async function test(c){
 if(c.provider==='database') return {ok:true,message:'Files will be stored in the application database.'};
 if(!['s3','supabase','folder'].includes(c.provider)) throw badRequest('Choose a storage provider.');
 if(c.provider==='folder'&&!require('path').isAbsolute(c.folder||'')) throw badRequest('Enter an absolute server folder path.');
 if(c.provider==='supabase'&&!/^https:\/\//.test(c.supabase.url)) throw badRequest('Use an HTTPS Supabase project URL.');
 const r=await require('./fileStorageAdapters').test(c.provider,c.provider==='folder'?{path:c.folder}:c[c.provider]);if(!r.ok) throw badRequest(r.message);return r;
}
module.exports={current,publicConfig,merge,save,adapter,test,encrypt,decrypt};
