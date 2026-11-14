'use strict';
process.env.VMTL_DB=':memory:';
process.env.SESSION_SECRET='fleet-test-secret';
if(process.env.VMTL_TEST_FLEET_PG==='1'){process.env.DB_RUNTIME='postgres';process.env.PGLITE_DIR='memory://';delete process.env.DATABASE_URL;}else delete process.env.DB_RUNTIME;
const {test}=require('node:test');const assert=require('node:assert/strict');
const db=require('../src/db/runtime');
test('university roles, owner dropdowns, private files and event schedules enforce permissions and preserve costs',async t=>{
 if(db.isPostgres()){await db.ensureSchema();t.after(()=>require('../src/db/postgres').close());}
 await db.run("INSERT INTO org_units(id,name,type,path) VALUES(1,'OU A','unit','/1/'),(2,'OU B','unit','/2/')");
 await db.run("INSERT INTO users(id,name,email,is_super_admin,org_unit_id) VALUES(1,'Owner','owner@test',1,1),(2,'UTO','uto@test',0,1),(3,'Scheduler','schedule@test',0,1),(4,'Staff','staff@test',0,1)");
 await require('../src/services/fleetSetup').ensureRoles();await require('../src/services/fleetSetup').ensureRoles();
 for(const [id,slug] of [[2,'university_transport_officer'],[3,'schedule_transport_officer']]) await db.run('UPDATE users SET role_id=(SELECT id FROM roles WHERE slug=?) WHERE id=?',[slug,id]);
 await db.run("INSERT INTO vehicles(id,vehicle_number,registration_number,capacity,org_unit_id,status,active) VALUES(1,'V1','R1',10,2,'available',1),(2,'V2','R2',4,1,'available',1)");
 await db.run("INSERT INTO drivers(id,name,org_unit_id,status,active) VALUES(1,'Driver B',2,'available',1),(2,'Driver A',1,'available',1)");
 if(db.isPostgres())for(const table of ['users','vehicles','drivers'])await db.run(`SELECT setval(pg_get_serial_sequence('${table}','id'),(SELECT MAX(id) FROM ${table}))`);
 const express=require('express'),app=require('../src/middleware/asyncSafe').asyncSafe(express());app.use(express.json({limit:'12mb'}));
 app.use(async(req,res,next)=>{req.session={user:await db.get('SELECT * FROM users WHERE id=?',[Number(req.headers['x-user']||1)])};next();});
 for(const name of ['fleet-operations','event-schedules','fuel','vehicles','drivers','maintenance','dashboard','users'])require('../src/routes/api/'+name)(app);app.use(require('../src/middleware/errorHandler'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const request=(method,url,body,user=1)=>fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'content-type':'application/json','x-user':String(user)},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await request('GET','/dropdowns',undefined,2)).status,403);
 let r=await request('PUT','/dropdowns/station',{options:[{value:'KNUST JP',label:'KNUST JP'},{value:'Campus',label:'Campus station'},{value:'other',label:'Other'}]});assert.equal(r.status,200);
 assert.equal((await request('PUT','/dropdowns/vehicle_status',{options:[{value:'custom',label:'Custom'}]})).status,422);
 const dropdowns=require('../src/services/dropdowns');assert.equal(await dropdowns.resolve({station:'other',station_other:'Shell'},'station'),'Shell');await assert.rejects(dropdowns.resolve({station:'other'},'station'));
 assert.equal((await request('GET','/vehicles?all=1',undefined,2)).status,200);assert.equal((await (await request('GET','/vehicles?all=1',undefined,2)).json()).data.length,2);
 assert.equal((await (await request('GET','/dashboard',undefined,2)).json()).data.fleet_only,true);
 assert.equal((await request('POST','/fuel-logs',{},2)).status,403);
 assert.equal((await request('POST','/drivers',{name:'X',create_login:true},2)).status,403);
 assert.equal((await request('POST','/drivers',{name:'X',create_login:true},3)).status,403);
 for(const route of ['/vehicles/1','/vehicles/1/trips','/vehicles/1/fuel','/drivers/1','/drivers/1/trips'])assert.equal((await request('GET',route,undefined,4)).status,403,route);
 const beforeDrivers=Number((await db.get('SELECT COUNT(*) AS n FROM drivers')).n);
 assert.equal((await request('POST','/drivers',{name:'Rollback driver',org_unit_id:1,create_login:true,login_email:'bad@test.com',login_password:'weak'})).status,422);
 assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM drivers')).n),beforeDrivers);

 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=','base64');
 assert.equal((await request('POST','/fleet-files/vehicle/1/photo',{data:png.toString('base64'),name:'vehicle.png'},4)).status,403);
 r=await request('POST','/fleet-files/vehicle/1/photo',{data:png.toString('base64'),name:'vehicle.png'},2);assert.equal(r.status,201);const file=(await r.json()).data;file.url=file.url.replace('/api','');
 assert.equal((await request('GET',file.url,undefined,4)).status,403);assert.deepEqual(Buffer.from(await (await request('GET',file.url,undefined,2)).arrayBuffer()),png);
 assert.equal((await request('POST','/fleet-files/vehicle/1/photo',{data:Buffer.from('<script/>').toString('base64'),name:'fake.jpg'},2)).status,422);
 r=await request('POST','/fleet-files/driver/2/licence',{data:png.toString('base64'),name:'licence.png'},2);assert.equal(r.status,201);
 const licence=(await r.json()).data.id;
 assert.equal((await request('GET','/fleet-files/'+licence,undefined,4)).status,403);
 assert.equal((await request('GET','/fleet-files/driver/2/latest/licence',undefined,4)).status,403);
 assert.equal((await request('GET','/fleet-files/'+licence,undefined,2)).status,200);
 const fs=require('fs/promises'),path=require('path');const folder=await fs.mkdtemp(path.join(require('os').tmpdir(),'vmtl-files-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 r=await request('PUT','/file-server',{provider:'folder',folder,enabled:true,maxMB:5});assert.equal(r.status,200);assert.equal((await request('POST','/file-server/move',{})).status,200);
 assert.deepEqual(Buffer.from(await (await request('GET',file.url,undefined,2)).arrayBuffer()),png);
 await request('PUT','/file-server',{provider:'database',enabled:false,maxMB:5});assert.equal((await request('POST','/fleet-files/vehicle/1/photo',{data:png.toString('base64'),name:'v.png'},2)).status,403);
 assert.equal((await request('POST','/transport-events',{name:'Denied'},2)).status,403);
 r=await request('POST','/transport-events',{name:'IDL exams',notes:'All OUs'},3);assert.equal(r.status,201);const event=(await r.json()).data;
 const booking={vehicle_id:1,driver_id:1,start:'2026-12-01T08:00',end:'2026-12-02T18:00',destination:'Kumasi',passengers:5};
 r=await request('POST',`/transport-events/${event.id}/schedules`,booking,3);assert.equal(r.status,201,await r.clone().text());const schedule=(await r.json()).data;
 assert.equal((await request('POST',`/transport-events/${event.id}/schedules`,booking,3)).status,409);
 assert.equal((await request('DELETE','/vehicles/1',{},2)).status,409);
 assert.equal((await request('DELETE','/drivers/1',{},2)).status,409);
 r=await request('GET','/transport-events/availability?'+new URLSearchParams({start:booking.start,end:booking.end}),undefined,3);assert.equal((await r.json()).vehicles.some(v=>v.id===1),false);
 assert.equal((await request('PUT',`/event-schedules/${schedule.id}`,{...booking,start:'2026-12-03T08:00',end:'2026-12-04T18:00'},3)).status,200);
 assert.equal((await request('POST',`/event-schedules/${schedule.id}/expenses`,{category:'toll',amount:12,description:'Road toll',expense_date:'2026-12-01'},3)).status,201);
 const fuel={vehicle_id:1,driver_id:1,schedule_id:schedule.id,purchase_date:'2026-12-01T09:00',odometer:100,litres:10,price_per_litre:15,fuel_type:'diesel',station:'other',station_other:'Shell'};
 r=await request('POST','/fuel-logs',fuel,3);assert.equal(r.status,201,await r.clone().text());const fuelId=(await r.json()).data.id;
 const withoutDriver={...fuel,price_per_litre:15};delete withoutDriver.driver_id;
 assert.equal((await request('PUT','/fuel-logs/'+fuelId,withoutDriver,3)).status,200);
 assert.equal(Number((await db.get('SELECT driver_id FROM fuel_logs WHERE id=?',[fuelId])).driver_id),1);
 assert.equal((await request('GET','/fuel-logs?schedule_id='+schedule.id,undefined,3)).status,200);
 assert.equal((await request('PUT',`/event-schedules/${schedule.id}`,{...booking,vehicle_id:2,passengers:3},3)).status,409);
 let data=(await (await request('GET','/transport-events',undefined,3)).json()).data;assert.equal(data[0].total_cost,162);
 assert.equal((await request('PUT','/fuel-logs/'+fuelId,{...fuel,price_per_litre:16},3)).status,200);
 const nextFuel={...fuel,schedule_id:undefined,purchase_date:'2026-12-02T09:00',odometer:200};
 r=await request('POST','/fuel-logs',nextFuel,3);assert.equal(r.status,201);const nextId=(await r.json()).data.id;
 assert.equal((await request('PUT','/fuel-logs/'+fuelId,{...fuel,odometer:120,price_per_litre:16},3)).status,200);
 assert.equal(Number((await db.get('SELECT previous_odometer FROM fuel_logs WHERE id=?',[nextId])).previous_odometer),120);
 assert.equal((await request('PUT','/fuel-logs/'+fuelId,{...fuel,odometer:250},3)).status,409);
 assert.equal(Number((await db.get('SELECT odometer FROM fuel_logs WHERE id=?',[fuelId])).odometer),120);
 assert.equal((await request('DELETE','/fuel-logs/'+nextId,{},3)).status,200);

 data=(await (await request('GET','/transport-events',undefined,3)).json()).data;assert.equal(data[0].total_cost,172);
 assert.equal((await request('DELETE','/fuel-logs/'+fuelId,{},3)).status,200);
 data=(await (await request('GET','/transport-events',undefined,3)).json()).data;assert.equal(data[0].total_cost,12);
 assert.equal((await request('PUT',`/event-schedules/${schedule.id}`,{...booking,vehicle_id:2,passengers:3},3)).status,200);
 assert.equal((await request('POST',`/event-schedules/${schedule.id}/cancel`,{},3)).status,200);assert.equal((await db.get('SELECT status FROM vehicles WHERE id=1')).status,'available');assert.equal((await db.get('SELECT status FROM vehicles WHERE id=2')).status,'available');
 await db.run("INSERT INTO roles(slug,name) VALUES('driver','Driver')");const role=await db.get("SELECT id FROM roles WHERE slug='driver'");
 r=await request('POST','/users',{name:'New driver',email:'newdriver@test.com',password:'Password123!',role_id:role.id,org_unit_id:1});assert.equal(r.status,201,await r.clone().text());const user=(await r.json()).data;
 assert.equal((await db.get('SELECT name FROM drivers WHERE user_id=?',[user.id])).name,'New driver');
 const nav=await require('../src/services/navigation').effective({id:2});const keys=nav.sections.flatMap(s=>s.items.map(x=>x.key));assert.ok(keys.includes('vehicles'));assert.ok(!keys.includes('trips'));assert.ok(!keys.includes('users'));
 const storage=require('../src/services/fileStorageConfig');
 const config=await storage.merge({provider:'supabase',supabase:{url:'https://storage.example.test',bucket:'private',serviceKey:'test-service-secret'}});
 await storage.save(config);
 const saved=await db.get("SELECT value FROM system_settings WHERE key='fleet_file_server'");assert.ok(!saved.value.includes('test-service-secret'));
 assert.equal((await storage.current()).supabase.serviceKey,'test-service-secret');
 assert.ok(!JSON.stringify(storage.publicConfig(await storage.current())).includes('test-service-secret'));
 assert.equal((await storage.merge({supabase:{serviceKey:''}})).supabase.serviceKey,'test-service-secret');
 const realFetch=global.fetch;const objects=new Map();let authHeader;
 try{
  global.fetch=async(url,options={})=>{
   authHeader=options.headers.Authorization;const key=String(url).replace('/authenticated/','/');
   if(options.method==='POST'||options.method==='PUT'){objects.set(key,Buffer.from(options.body));return new Response('',{status:200});}
   if(options.method==='DELETE'){objects.delete(key);return new Response('',{status:200});}
   return new Response(objects.get(key)||null,{status:objects.has(key)?200:404});
  };
  const adapter=storage.adapter(config);await adapter.put('fleet/test.png',png,'image/png');assert.equal(authHeader,'Bearer test-service-secret');assert.deepEqual(await adapter.get('fleet/test.png'),png);assert.equal(await adapter.remove('fleet/test.png'),true);
  const s3=storage.adapter({...config,provider:'s3',s3:{endpoint:'https://s3.example.test',region:'us-east-1',bucket:'fleet',accessKeyId:'access',secretAccessKey:'secret',pathStyle:true}});
  await s3.put('test.png',png,'image/png');assert.match(authHeader,/^AWS4-HMAC-SHA256 Credential=access\//);assert.deepEqual(await s3.get('test.png'),png);
 }finally{global.fetch=realFetch;}

});
