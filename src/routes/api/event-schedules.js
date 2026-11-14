'use strict';
const db=require('../../db/runtime');
const {requireAuth}=require('../../middleware/auth');
const {has,inScope}=require('../../services/authz');
const {forbidden,notFound,conflict}=require('../../middleware/errorHandler');
const {validate}=require('../../util/validate');
const audit=require('../../services/audit');
const notifications=require('../../services/notifications');
const sequence=require('../../services/sequence');
const orgScope=require('../../services/orgScope');
const log=require('../../util/log');
module.exports=router=>{
 const guard=async(req,res,next)=>{if(!await has(req,'schedule.events')) throw forbidden();next();};
 const schedule=async id=>{const s=await db.get('SELECT s.*,t.vehicle_id,t.driver_id,t.status,t.trip_number,t.scheduled_start,t.scheduled_end,r.destination,r.passenger_count FROM event_schedules s JOIN trips t ON t.id=s.trip_id JOIN vehicle_requests r ON r.id=t.vehicle_request_id WHERE s.id=?',[id]);if(!s) throw notFound();return s;};
 // schedule.events normally comes with fleet.global (university-wide), but a role
 // granted it on RBAC without fleet.global must stay inside its own org units.
 const scheduleInScope=async(req,s)=>{const v=await db.get('SELECT org_unit_id FROM vehicles WHERE id=?',[s.vehicle_id]);if(!await inScope(req.session.user,v?.org_unit_id)) throw forbidden('This schedule is outside your scope.');return s;};
 const pairInScope=async(req,v,driver)=>{if(!await inScope(req.session.user,v.org_unit_id)||!await inScope(req.session.user,driver.org_unit_id)) throw forbidden('Vehicle or driver is outside your scope.');};
 const human=v=>String(v||'').replace('T',' ').slice(0,16);
 // Best-effort, like the normal assignment flow: a notification failure never undoes the schedule.
 const notifyDriver=async(driverId,type,s)=>{
  try{
   const d=await db.get('SELECT user_id FROM drivers WHERE id=?',[driverId]);if(!d||!d.user_id) return;
   const v=await db.get('SELECT vehicle_number FROM vehicles WHERE id=?',[s.vehicle_id]);
   await notifications.toUser(d.user_id,type,{trip_id:s.trip_id,trip_number:s.trip_number,vehicle:v?v.vehicle_number:'',start:human(s.scheduled_start),end:human(s.scheduled_end)});
  }catch(err){log.warn('idl_notification_failed',{type,message:err.message});}
 };
 router.get('/transport-events',requireAuth,guard,async(req,res)=>{
  const scope=await orgScope.visibleOrgUnitIds(req.session.user);
  const events=await db.all('SELECT * FROM transport_events ORDER BY id DESC');
  for(const e of events){
   e.schedules=(await db.all(`SELECT s.*,t.vehicle_id,t.driver_id,t.trip_number,t.scheduled_start,t.scheduled_end,t.status,v.vehicle_number,v.org_unit_id AS vehicle_org_unit_id,d.name AS driver_name,r.destination,r.passenger_count FROM event_schedules s JOIN trips t ON t.id=s.trip_id JOIN vehicles v ON v.id=t.vehicle_id JOIN drivers d ON d.id=t.driver_id JOIN vehicle_requests r ON r.id=t.vehicle_request_id WHERE s.event_id=? ORDER BY t.scheduled_start`,[e.id])).filter(s=>scope===null||scope.includes(s.vehicle_org_unit_id));
   e.total_cost=0;
   for(const s of e.schedules){s.expenses=await db.all('SELECT * FROM schedule_expenses WHERE schedule_id=? ORDER BY expense_date,id',[s.id]);s.total_cost=s.expenses.reduce((n,x)=>n+Number(x.amount),0);e.total_cost+=s.total_cost;}
  }
  res.json({data:events});
 });
 router.post('/transport-events',requireAuth,guard,async(req,res)=>{
  const d=validate(req.body,{name:{required:true,type:'string',maxLength:255},notes:{type:'string',maxLength:2000}});
  const r=await db.run('INSERT INTO transport_events(name,notes,created_by) VALUES(?,?,?)',[d.name,d.notes||null,req.session.user.id]);
  await audit.from(req,{action:'transport_event.created',description:`Created event ${d.name}`});res.status(201).json({data:{id:r.lastInsertRowid,...d}});
 });
 router.put('/transport-events/:id',requireAuth,guard,async(req,res)=>{
  const d=validate(req.body,{name:{required:true,type:'string',maxLength:255},notes:{type:'string',maxLength:2000}});
  if(!await db.get('SELECT id FROM transport_events WHERE id=?',[req.params.id])) throw notFound();
  await db.run('UPDATE transport_events SET name=?,notes=? WHERE id=?',[d.name,d.notes||null,req.params.id]);
  await audit.from(req,{action:'transport_event.updated',description:`Updated event #${req.params.id}`});res.json({data:d});
 });
 router.delete('/schedule-expenses/:id',requireAuth,guard,async(req,res)=>{
  const e=await db.get('SELECT * FROM schedule_expenses WHERE id=?',[req.params.id]);if(!e) throw notFound();
  await scheduleInScope(req,await schedule(e.schedule_id));
  if(e.fuel_log_id) throw conflict('Manage linked fuel purchases from the Fuel page.');
  await db.run('DELETE FROM schedule_expenses WHERE id=?',[e.id]);await audit.from(req,{action:'event.expense_removed',description:`Removed expense #${e.id}`});res.json({ok:true});
 });
 router.get('/transport-events/availability' ,requireAuth,guard,async(req,res)=>{
  const d=validate(req.query,{start:{required:true,type:'date'},end:{required:true,type:'date',after:'start'},passengers:{type:'integer',min:1,max:150}});
  const existing=req.query.schedule_id?await scheduleInScope(req,await schedule(req.query.schedule_id)):null;
  const scope=await orgScope.visibleOrgUnitIds(req.session.user);
  const a=require('../../services/availability');res.json({vehicles:await a.availableVehicles(d.start,d.end,d.passengers||1,scope,existing?.trip_id),drivers:await a.availableDrivers(d.start,d.end,scope,existing?.trip_id)});
 });
 router.post('/transport-events/:id/schedules',requireAuth,guard,async(req,res)=>{
  const d=validate(req.body,{vehicle_id:{required:true,type:'integer'},driver_id:{required:true,type:'integer'},start:{required:true,type:'date'},end:{required:true,type:'date',after:'start'},destination:{required:true,type:'string',maxLength:255},passengers:{required:true,type:'integer',min:1,max:150}});
  const id=await db.transaction(async tx=>{
   const e=await tx.get('SELECT * FROM transport_events WHERE id=?',[req.params.id]);if(!e) throw notFound();
   const lock=db.isPostgres()?' FOR UPDATE':'';
   const v=await tx.get('SELECT * FROM vehicles WHERE id=?'+lock,[d.vehicle_id]);const driver=await tx.get('SELECT * FROM drivers WHERE id=?'+lock,[d.driver_id]);
   if(!v || !driver || v.deleted_at || driver.deleted_at || !v.active || !driver.active || !['available','scheduled'].includes(v.status)||driver.status!=='available') throw conflict('Choose an available vehicle and driver.');
   await pairInScope(req,v,driver);
   if(v.capacity<d.passengers) throw conflict('Vehicle capacity is too small.');
   if(await tx.get("SELECT id FROM trips WHERE status IN ('scheduled','in_progress') AND (vehicle_id=? OR driver_id=?) AND scheduled_start<? AND scheduled_end>?",[v.id,driver.id,d.end,d.start])) throw conflict('Vehicle or driver is already booked for that time.');
   // Readable numbers (they appear in driver SMS/email), on prefixes that never collide with TRIP-/REQ-.
   const requestNumber=await sequence.next('vehicle_requests','request_number','IDL-REQ');
   const tripNumber=await sequence.next('trips','trip_number','IDL-TRIP');
   const r=await tx.run(`INSERT INTO vehicle_requests(request_number,requester_id,org_unit_id,travel_date,requested_start_time,expected_end_time,destination,purpose,passenger_count,is_external,external_org,status) VALUES(?,?,?,?,?,?,?,?,?,1,'IDL','scheduled')`,[requestNumber,req.session.user.id,v.org_unit_id,d.start.slice(0,10),d.start,d.end,d.destination,e.name,d.passengers]);
   const t=await tx.run("INSERT INTO trips(trip_number,vehicle_request_id,vehicle_id,driver_id,scheduled_start,scheduled_end,status,assigned_by) VALUES(?,?,?,?,?,?,'scheduled',?)",[tripNumber,r.lastInsertRowid,v.id,driver.id,d.start,d.end,req.session.user.id]);
   await tx.run("UPDATE vehicles SET status='scheduled' WHERE id=?",[v.id]);
   return (await tx.run('INSERT INTO event_schedules(event_id,trip_id) VALUES(?,?)',[e.id,t.lastInsertRowid])).lastInsertRowid;
  });
  const created=await schedule(id);
  await audit.from(req,{action:'event.scheduled',description:`Assigned driver and vehicle for event #${req.params.id}`,entityType:'event_schedule',entityId:id});
  await notifyDriver(created.driver_id,'vehicle_assigned',created);
  res.status(201).json({data:created});
 });
 router.get('/event-schedules/:id',requireAuth,guard,async(req,res)=>res.json({data:await scheduleInScope(req,await schedule(req.params.id))}));

 router.put('/event-schedules/:id',requireAuth,guard,async(req,res)=>{
  const d=validate(req.body,{vehicle_id:{required:true,type:'integer'},driver_id:{required:true,type:'integer'},start:{required:true,type:'date'},end:{required:true,type:'date',after:'start'},destination:{required:true,type:'string',maxLength:255},passengers:{required:true,type:'integer',min:1,max:150}});
  const s=await scheduleInScope(req,await schedule(req.params.id));
  await db.transaction(async tx=>{
   const lock=db.isPostgres()?' FOR UPDATE':'';
   const t=await tx.get('SELECT * FROM trips WHERE id=?'+lock,[s.trip_id]);if(t.status!=='scheduled')throw conflict('Only scheduled travel can be rescheduled.');
   if((Number(t.vehicle_id)!==d.vehicle_id || Number(t.driver_id)!==d.driver_id) && await tx.get('SELECT id FROM schedule_expenses WHERE schedule_id=? AND fuel_log_id IS NOT NULL',[s.id])) throw conflict('This schedule has fuel recorded. Cancel and create a new schedule to change its vehicle or driver.');
   for(const vehicleId of [...new Set([Number(t.vehicle_id),d.vehicle_id])].sort((a,b)=>a-b)) await tx.get('SELECT id FROM vehicles WHERE id=?'+lock,[vehicleId]);
   const v=await tx.get('SELECT * FROM vehicles WHERE id=?',[d.vehicle_id]);const driver=await tx.get('SELECT * FROM drivers WHERE id=?'+lock,[d.driver_id]);
   if(!v||!driver||v.deleted_at||driver.deleted_at||!v.active||!driver.active||!['available','scheduled'].includes(v.status)||driver.status!=='available')throw conflict('Choose an available vehicle and driver.');
   await pairInScope(req,v,driver);
   if(v.capacity<d.passengers)throw conflict('Vehicle capacity is too small.');
   if(await tx.get("SELECT id FROM trips WHERE id!=? AND status IN ('scheduled','in_progress') AND (vehicle_id=? OR driver_id=?) AND scheduled_start<? AND scheduled_end>?",[t.id,v.id,driver.id,d.end,d.start]))throw conflict('Vehicle or driver is already booked for that time.');
   await tx.run('UPDATE trips SET vehicle_id=?,driver_id=?,scheduled_start=?,scheduled_end=? WHERE id=?',[v.id,driver.id,d.start,d.end,t.id]);
   await tx.run('UPDATE vehicle_requests SET destination=?,passenger_count=?,travel_date=?,requested_start_time=?,expected_end_time=?,org_unit_id=? WHERE id=?',[d.destination,d.passengers,d.start.slice(0,10),d.start,d.end,v.org_unit_id,t.vehicle_request_id]);
   await tx.run("UPDATE vehicles SET status='scheduled' WHERE id=?",[v.id]);
   if(Number(t.vehicle_id)!==Number(v.id)&&!await tx.get("SELECT id FROM trips WHERE vehicle_id=? AND status IN ('scheduled','in_progress')",[t.vehicle_id]))await tx.run("UPDATE vehicles SET status='available' WHERE id=? AND status='scheduled'",[t.vehicle_id]);
  });
  const after=await schedule(s.id);
  await audit.from(req,{action:'event.rescheduled',description:`Updated schedule #${s.id}`});
  if(Number(s.driver_id)!==Number(after.driver_id)){await notifyDriver(s.driver_id,'trip_cancelled',s);await notifyDriver(after.driver_id,'vehicle_assigned',after);}
  else if(['vehicle_id','scheduled_start','scheduled_end','destination'].some(k=>String(s[k])!==String(after[k]))) await notifyDriver(after.driver_id,'trip_rescheduled',after);
  res.json({data:after});
 });
 router.post('/event-schedules/:id/cancel',requireAuth,guard,async(req,res)=>{
  const s=await scheduleInScope(req,await schedule(req.params.id));if(s.status!=='scheduled') throw conflict('Only a scheduled trip can be cancelled.');
  await db.transaction(async tx=>{
   const t=await tx.get('SELECT * FROM trips WHERE id=?'+(db.isPostgres()?' FOR UPDATE':''),[s.trip_id]);if(t.status!=='scheduled') throw conflict('Only scheduled travel can be cancelled.');
   await tx.get('SELECT id FROM vehicles WHERE id=?'+(db.isPostgres()?' FOR UPDATE':''),[t.vehicle_id]);
   await tx.run("UPDATE trips SET status='cancelled' WHERE id=?",[t.id]);await tx.run("UPDATE vehicle_requests SET status='cancelled' WHERE id=?",[t.vehicle_request_id]);
   if(!await tx.get("SELECT id FROM trips WHERE vehicle_id=? AND status IN ('scheduled','in_progress')",[t.vehicle_id])) await tx.run("UPDATE vehicles SET status='available' WHERE id=? AND status='scheduled'",[t.vehicle_id]);
  });await audit.from(req,{action:'event.schedule_cancelled',description:`Cancelled schedule #${s.id}`});
  await notifyDriver(s.driver_id,'trip_cancelled',s);
  res.json({ok:true});
 });
 router.post('/event-schedules/:id/expenses',requireAuth,guard,async(req,res)=>{
  const s=await scheduleInScope(req,await schedule(req.params.id));
  if(s.status==='cancelled') throw conflict('This schedule was cancelled; costs can no longer be recorded against it.');
  const d=validate(req.body,{category:{required:true,type:'string',in:(await require('../../services/dropdowns').options()).expense_category.map(o=>o.value)},amount:{required:true,type:'number',min:0.01},description:{required:true,type:'string',maxLength:1000},expense_date:{required:true,type:'date'}});
  const r=await db.run('INSERT INTO schedule_expenses(schedule_id,category,amount,description,expense_date,recorded_by) VALUES(?,?,?,?,?,?)',[Number(req.params.id),d.category,d.amount,d.description,d.expense_date,req.session.user.id]);
  await audit.from(req,{action:'event.expense_added',description:`Recorded ${d.category} expense for schedule #${req.params.id}`});res.status(201).json({data:{id:r.lastInsertRowid,...d}});
 });
};
