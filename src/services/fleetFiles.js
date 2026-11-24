'use strict';
const db=require('../db/runtime');
const { attachment, decode, fileName, reject } = require('./uploadValidation');
const fs=require('fs/promises');
const path=require('path');
const crypto=require('crypto');
const {has,inScope}=require('./authz');
const {forbidden,notFound,badRequest}=require('../middleware/errorHandler');
const types={vehicle:{table:'vehicles',cap:'vehicles.manage',kinds:['photo']},driver:{table:'drivers',cap:'drivers.manage',kinds:['photo','licence']},maintenance:{table:'maintenance_records',cap:'maintenance.manage',kinds:['receipt']},incident:{table:'incidents',cap:'incidents.manage',kinds:['photo']},work_order:{table:'work_orders',cap:'maintenance.manage',kinds:['receipt']},request:{table:'vehicle_requests',cap:'requests.create_external',kinds:['letter']}};
const PDF_KINDS=['receipt','letter'];
const storage=require('./fileStorageConfig');
async function config(){return storage.current();}
async function access(req,type,id,write=false,kind=null){
 const meta=Object.hasOwn(types,type)?types[type]:null; if(!meta) throw notFound();
 const row=await db.get(`SELECT * FROM ${meta.table} WHERE id=? AND deleted_at IS NULL`,[id]); if(!row) throw notFound();
 if(type==='driver' && kind==='licence' && !await has(req,'drivers.manage') && Number(row.user_id)!==Number(req.session.user.id)) throw forbidden('You may not view this licence photo.');
 let org=row.org_unit_id;
 if(type==='maintenance') org=(await db.get('SELECT org_unit_id FROM vehicles WHERE id=?',[row.vehicle_id]))?.org_unit_id;
 if(!await inScope(req.session.user,org)) throw forbidden();
 const ownRequest=type==='request' && Number(row.requester_id)===Number(req.session.user.id);
 if(write && !ownRequest && !await has(req,meta.cap)) throw forbidden();
 if(type==='maintenance' && !await has(req,meta.cap)) throw forbidden();
 return meta;
}
async function upload(req, type, id, kind, body) {
 const meta = await access(req, type, id, true);
 if (!meta.kinds.includes(kind)) reject('FILE_KIND', 'Invalid attachment type.');
 const c = req.uploadConfig || await config();
 if (!c.enabled) reject('FILE_DISABLED', 'File uploads are turned off.', 403);

 const limit = c.maxMB * 1048576;
 const name = Buffer.isBuffer(body) ? fileName(req) : body?.name;
 const buf = Buffer.isBuffer(body) ? body : decode(body?.data, limit);
 const mime = attachment(buf, name, kind, limit);
 const displayName = path.win32.basename(name).slice(-255);
 const opId = req.get('X-Op-Id');
 const retryKey = opId && /^[a-z0-9-]{1,80}$/i.test(opId)
  ? crypto.createHash('sha256').update(JSON.stringify([req.session.user.id, type, Number(id), kind, displayName, opId])).update(buf).digest('hex')
  : null;
 const response = id => ({ id, url: '/api/fleet-files/' + id });
 const replay = () => db.get('SELECT id FROM fleet_files WHERE upload_key=?', [retryKey]);
 if (retryKey) {
  const previous = await replay();
  if (previous) return { data: response(previous.id), replayed: true };
 }

 const since = new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
 const used = await db.get('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM fleet_files WHERE uploaded_by=? AND created_at>=?', [req.session.user.id, since]);
 if (c.dailyMB && Number(used.bytes) + buf.length > c.dailyMB * 1048576) reject('FILE_QUOTA', 'Daily upload allowance exceeded.');

 let key = null, profile = null, remove;
 try {
  if (['s3', 'supabase'].includes(c.provider)) {
   const adapter = storage.adapter(c);
   profile = storage.encrypt(c);
   key = 'vmtl/' + crypto.randomUUID();
   remove = () => adapter.remove(key);
   await adapter.put(key, buf, mime);
  }
  if (c.provider === 'folder') {
   const directory = path.resolve(c.folder);
   await fs.mkdir(directory, { recursive: true });
   key = path.join(directory, crypto.randomUUID());
   remove = () => fs.unlink(key);
   await fs.writeFile(key, buf, { flag: 'wx' });
  }
  const result = await db.run(
   'INSERT INTO fleet_files(entity_type,entity_id,kind,file_name,mime_type,size_bytes,data_base64,storage_key,storage_profile,uploaded_by,upload_key) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(upload_key) DO NOTHING',
   [type, Number(id), kind, displayName, mime, buf.length, key ? null : buf.toString('base64'), key, profile, req.session.user.id, retryKey]
  );
  if (result.changes) return { data: response(result.lastInsertRowid), replayed: false };
 } catch (error) {
  if (remove) await remove().catch(() => {});
  throw error;
 }
 if (remove) await remove().catch(() => {});
 return { data: response((await replay()).id), replayed: true };
}
async function read(f){if(f.storage_profile) return storage.adapter(storage.decrypt(f.storage_profile)).get(f.storage_key);return f.storage_key?fs.readFile(f.storage_key):Buffer.from(f.data_base64,'base64');}
module.exports={config,access,upload,read};
