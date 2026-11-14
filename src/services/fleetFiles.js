'use strict';
const db=require('../db/runtime');
const settings=require('./settings');
const fs=require('fs/promises');
const path=require('path');
const crypto=require('crypto');
const {has,inScope}=require('./authz');
const {forbidden,notFound,badRequest}=require('../middleware/errorHandler');
const types={vehicle:{table:'vehicles',cap:'vehicles.manage',kinds:['photo']},driver:{table:'drivers',cap:'drivers.manage',kinds:['photo','licence']},maintenance:{table:'maintenance_records',cap:'maintenance.manage',kinds:['receipt']}};
const storage=require('./fileStorageConfig');
async function config(){return storage.current();}
async function access(req,type,id,write=false,kind=null){
 const meta=Object.hasOwn(types,type)?types[type]:null; if(!meta) throw notFound();
 const row=await db.get(`SELECT * FROM ${meta.table} WHERE id=? AND deleted_at IS NULL`,[id]); if(!row) throw notFound();
 if(type==='driver' && kind==='licence' && !await has(req,'drivers.manage') && Number(row.user_id)!==Number(req.session.user.id)) throw forbidden('You may not view this licence photo.');
 let org=row.org_unit_id;
 if(type==='maintenance') org=(await db.get('SELECT org_unit_id FROM vehicles WHERE id=?',[row.vehicle_id]))?.org_unit_id;
 if(!await inScope(req.session.user,org)) throw forbidden();
 if(write && !await has(req,meta.cap)) throw forbidden();
 if(type==='maintenance' && !await has(req,meta.cap)) throw forbidden();
 return meta;
}
function sniff(buf){
 if(buf.subarray(0,3).equals(Buffer.from([255,216,255]))) return 'image/jpeg';
 if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
 if(buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP') return 'image/webp';
 if(buf.toString('ascii',0,5)==='%PDF-') return 'application/pdf';
 return null;
}
async function upload(req,type,id,kind,body){
 const meta=await access(req,type,id,true); if(!meta.kinds.includes(kind)) throw badRequest('Invalid attachment type.');
 const c=await config(); if(!c.enabled) throw forbidden('File uploads are turned off.');
 if(typeof body.data!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw badRequest('Invalid file.');
 const buf=Buffer.from(body.data,'base64'); const mime=sniff(buf);
 if(!buf.length || buf.length>c.maxMB*1024*1024) throw badRequest(`File must be at most ${c.maxMB} MB.`);
 if(!mime || (kind!=='receipt' && mime==='application/pdf')) throw badRequest('Use a JPEG, PNG or WebP image, or a PDF receipt.');
 const since=new Date(Date.now()-86400000).toISOString().replace('T',' ').slice(0,19);
 const used=await db.get('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM fleet_files WHERE uploaded_by=? AND created_at>=?',[req.session.user.id,since]);
 if(c.dailyMB && Number(used.bytes)+buf.length>c.dailyMB*1048576) throw badRequest('Daily upload allowance exceeded.');
 let key=null,profile=null;
 if(['s3','supabase'].includes(c.provider)){
  const adapter=storage.adapter(c);profile=storage.encrypt(c);key='vmtl/'+crypto.randomUUID();await adapter.put(key,buf,mime);
 }
 if(c.provider==='folder'){
  const directory=path.resolve(c.folder); await fs.mkdir(directory,{recursive:true});
  key=path.join(directory,crypto.randomUUID()); await fs.writeFile(key,buf,{flag:'wx'});
 }
 try {
 const r=await db.run('INSERT INTO fleet_files(entity_type,entity_id,kind,file_name,mime_type,size_bytes,data_base64,storage_key,storage_profile,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?,?)',[type,Number(id),kind,path.basename(String(body.name||'attachment')).slice(0,255),mime,buf.length,key?null:buf.toString('base64'),key,profile,req.session.user.id]);
 return {id:r.lastInsertRowid,url:`/api/fleet-files/${r.lastInsertRowid}`};
 }catch(e){if(key){if(profile) await storage.adapter(c).remove(key).catch(()=>{});else await fs.unlink(key).catch(()=>{});}throw e;}
}
async function read(f){if(f.storage_profile) return storage.adapter(storage.decrypt(f.storage_profile)).get(f.storage_key);return f.storage_key?fs.readFile(f.storage_key):Buffer.from(f.data_base64,'base64');}
module.exports={config,access,upload,sniff,read};
