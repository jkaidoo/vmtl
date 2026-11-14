'use strict';
const db=require('../db/runtime');
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
}
module.exports={ensureRoles};
