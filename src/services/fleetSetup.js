'use strict';
const db=require('../db/runtime');
const settings=require('./settings');
async function ensureRoles(){
 const defaults=require('./capabilities').defaultsByRole();
 for(const slug of ['university_transport_officer','schedule_transport_officer']) {
  if(await db.get('SELECT id FROM roles WHERE slug=?',[slug])) continue;
  await db.transaction(async tx=>{
   const r=await tx.run('INSERT INTO roles(slug,name) VALUES(?,?) ON CONFLICT(slug) DO NOTHING',[slug,require('./roles').LABELS[slug]]);
   if(!r.changes) return;
   for(const cap of defaults[slug]) await tx.run('INSERT INTO role_capabilities(role_id,capability) VALUES(?,?)',[r.lastInsertRowid,cap]);
  });
 }
 await ensureScheduleCaps();
 await ensureUtoScheduleCaps();
}
// The University Transport Officer gains the ability to set up Transport Schedule
// events (and trigger the availability notification). Additively grant the caps
// once to the existing role; a one-time flag means a later admin removal sticks.
async function ensureUtoScheduleCaps(){
 if(await settings.get('uto_schedule_caps_seeded',false)) return;
 const caps=['schedule.view','schedule.manage'];
 const role=await db.get("SELECT id FROM roles WHERE slug='university_transport_officer'");
 if(role) for(const cap of caps) await db.run('INSERT INTO role_capabilities(role_id,capability) VALUES(?,?) ON CONFLICT(role_id,capability) DO NOTHING',[role.id,cap]);
 await settings.set('uto_schedule_caps_seeded',true);
}
// The Transport Scheduling capabilities ship after the schedule_transport_officer
// role already exists, so the role seeder above skips it. Additively grant the
// new caps to that role once; a one-time flag means a later admin removal sticks.
async function ensureScheduleCaps(){
 if(await settings.get('ts_schedule_caps_seeded',false)) return;
 const caps=['schedule.view','schedule.manage','schedule.publish','schedule.notify','schedule.config'];
 const role=await db.get("SELECT id FROM roles WHERE slug='schedule_transport_officer'");
 if(role) for(const cap of caps) await db.run('INSERT INTO role_capabilities(role_id,capability) VALUES(?,?) ON CONFLICT(role_id,capability) DO NOTHING',[role.id,cap]);
 await settings.set('ts_schedule_caps_seeded',true);
}
module.exports={ensureRoles};
