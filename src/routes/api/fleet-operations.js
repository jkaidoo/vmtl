'use strict';

const db=require('../../db/runtime');

const {requireAuth}=require('../../middleware/auth');

const {has}=require('../../services/authz');

const {forbidden,badRequest,notFound}=require('../../middleware/errorHandler');

const files=require('../../services/fleetFiles');

const audit=require('../../services/audit');

module.exports=router=>{

 const owner=(req,res,next)=>{if(!req.session.user.is_super_admin) throw forbidden(); next();};

 router.get('/file-upload-config',requireAuth,async(req,res)=>{const c=await files.config();res.json({enabled:c.enabled,maxMB:c.maxMB,images:c.images});});

 router.get('/dropdowns',requireAuth,owner,async(req,res)=>res.json({data:await require('../../services/dropdowns').options()}));

 router.put('/dropdowns/:key',requireAuth,owner,async(req,res)=>{

  const data=await require('../../services/dropdowns').save(req.params.key,req.body.options);

  await audit.from(req,{action:'dropdown.updated',description:`Updated ${req.params.key} choices`}); res.json({data});

 });

 router.post('/fleet-files/:type/:id/:kind',requireAuth,async(req,res)=>{

  const data=await files.upload(req,req.params.type,req.params.id,req.params.kind,req.body);

  await audit.from(req,{action:'file.uploaded',description:`Uploaded ${req.params.kind} for ${req.params.type} #${req.params.id}`});

  res.status(201).json({data});

 });

 router.get('/fleet-files/:type/:id/latest/:kind',requireAuth,async(req,res)=>{

  await files.access(req,req.params.type,req.params.id,false,req.params.kind);

  const f=await db.get('SELECT id FROM fleet_files WHERE entity_type=? AND entity_id=? AND kind=? ORDER BY id DESC LIMIT 1',[req.params.type,req.params.id,req.params.kind]);

  if(!f){if(req.params.kind==='photo')return res.type('image/svg+xml').set('Cache-Control','private, no-store').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#e5e7eb"/><circle cx="24" cy="17" r="8" fill="#9ca3af"/><path d="M8 43a16 16 0 0132 0" fill="#9ca3af"/></svg>');return res.status(204).end();} res.redirect(`/api/fleet-files/${f.id}`);

 });

 router.get('/fleet-files/:id',requireAuth,async(req,res)=>{

  const f=await db.get('SELECT * FROM fleet_files WHERE id=?',[req.params.id]); if(!f) throw notFound();

  await files.access(req,f.entity_type,f.entity_id,false,f.kind);

  const buf=await files.read(f);if(!buf) throw notFound('Stored file is unavailable.');

  res.set({'Content-Type':f.mime_type,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(buf);

 });

 router.get('/file-server',requireAuth,owner,async(req,res)=>res.json({config:require('../../services/fileStorageConfig').publicConfig(await files.config()),usage:await db.get('SELECT COUNT(*) AS files,COALESCE(SUM(size_bytes),0) AS bytes FROM fleet_files'),largest:await db.all('SELECT id,file_name,size_bytes,entity_type,kind,created_at FROM fleet_files ORDER BY size_bytes DESC LIMIT 15')}));

 const storage=require('../../services/fileStorageConfig');

 const test=c=>storage.test(c);

 router.post('/file-server/test',requireAuth,owner,async(req,res)=>res.json(await test(await storage.merge(req.body))));

 router.put('/file-server',requireAuth,owner,async(req,res)=>{

  const c=await storage.merge(req.body);

  if(!Number.isInteger(c.maxMB)||c.maxMB<1||c.maxMB>8) throw badRequest('Upload limit must be 1–8 MB.');

  if(!Number.isInteger(c.dailyMB)||c.dailyMB<0||c.dailyMB>100000) throw badRequest('Daily allowance must be 0–100000 MB.');

  if(typeof c.enabled!=='boolean') throw badRequest('Uploads must be on or off.');

  if(!Number.isInteger(c.images.maxEdge)||c.images.maxEdge<640||c.images.maxEdge>4096||!Number.isFinite(c.images.quality)||c.images.quality<0.4||c.images.quality>1) throw badRequest('Choose valid image settings.');

  await test(c); await storage.save(c);

  await audit.from(req,{action:'file_server.updated',description:'Updated file storage configuration'});res.json({config:storage.publicConfig(c)});

 });

 router.post('/file-server/move',requireAuth,owner,async(req,res)=>{

  const c=await files.config(); if(c.provider==='database') throw badRequest('Save a file server first.'); await test(c);

  let moved=0;

  for(const f of await db.all('SELECT id,data_base64 FROM fleet_files WHERE storage_key IS NULL')){

   const remote=['s3','supabase'].includes(c.provider);const adapter=remote?storage.adapter(c):null;

   const p=remote?'vmtl/'+require('crypto').randomUUID():require('path').join(c.folder,require('crypto').randomUUID()),fs=require('fs/promises');

   const buf=Buffer.from(f.data_base64,'base64'); if(remote) await adapter.put(p,buf,'application/octet-stream');else await fs.writeFile(p,buf,{flag:'wx'});

   const back=remote?await adapter.get(p):await fs.readFile(p);if(!back || !back.equals(buf)) throw Error('File verification failed');

   await db.run('UPDATE fleet_files SET storage_key=?,storage_profile=?,data_base64=NULL WHERE id=?',[p,remote?storage.encrypt(c):null,f.id]); moved++;

  }

  await audit.from(req,{action:'files.moved',description:`Moved ${moved} files to server folder`});res.json({moved});

 });

};
