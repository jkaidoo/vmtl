'use strict';
process.env.VMTL_DB = ':memory:';
delete process.env.DB_RUNTIME;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { asyncSafe } = require('../src/middleware/asyncSafe');
const errorHandler = require('../src/middleware/errorHandler');
const db = require('../src/db/sqlite');
const tracking = require('../src/services/tracking');
const beaconToken = require('../src/services/beaconToken');

test('scoped beacon token is issued only on an active trip and records fixes without the session', async () => {
  db.exec(`
    INSERT INTO roles(id,slug,name) VALUES (1,'driver','Driver');
    INSERT INTO org_units(id,name,type,path) VALUES (1,'A','unit','/1/');
    INSERT INTO users(id,name,email,password_hash,role_id,org_unit_id) VALUES
      (2,'Driver','driver@test','x',1,1),(5,'Idle Driver','idle@test','x',1,1);
    INSERT INTO vehicles(id,vehicle_number,registration_number,vehicle_type,org_unit_id) VALUES (1,'V1','REG1','bus_coaster',1);
    INSERT INTO drivers(id,name,user_id,org_unit_id) VALUES (1,'Driver',2,1),(2,'Idle Driver',5,1);
    INSERT INTO vehicle_requests(id,request_number,requester_id,org_unit_id,travel_date,requested_start_time,expected_end_time,destination,purpose)
      VALUES (1,'R1',2,1,'2026-11-14','08:00','10:00','Campus','Work');
    INSERT INTO trips(id,trip_number,vehicle_request_id,vehicle_id,driver_id,scheduled_start,scheduled_end,status) VALUES
      (1,'T1',1,1,1,'2026-11-14 08:00:00','2026-11-14 10:00:00','in_progress');
  `);

  // issueBeacon: a driver with an in-progress trip gets a verifiable, trip-scoped token.
  const minted = await tracking.issueBeacon({ id: 2 });
  assert.equal(minted.active, true);
  assert.equal(minted.trip_id, 1);
  const claims = beaconToken.verify(minted.token);
  assert.deepEqual({ u: claims.userId, t: claims.tripId }, { u: 2, t: 1 });

  // A driver with no in-progress trip is told to stand down — no token handed out.
  const idle = await tracking.issueBeacon({ id: 5 });
  assert.deepEqual(idle, { active: false });

  // Mount the tracking route with NO session user: the token must carry auth on its own.
  const app = asyncSafe(express());
  app.use(express.json());
  app.use((req, res, next) => { req.session = {}; next(); });
  require('../src/routes/api/tracking')(app);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (headers, body) => fetch(`http://127.0.0.1:${server.address().port}/tracking/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  try {
    // Valid scoped token → fix is recorded against the trip's vehicle, no session needed.
    const ok = await post({ Authorization: `Bearer ${minted.token}` }, { lat: 6.6745, lng: -1.5716 });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { tracked: true, vehicle_id: 1, trip_id: 1 });
    const stored = db.prepare('SELECT vehicle_id, lat, recorded_by FROM vehicle_positions WHERE vehicle_id = 1').get();
    assert.equal(stored.recorded_by, 2);

    // Expired token → 401 with a retoken hint so the device mints a fresh one.
    const expired = beaconToken.issue(2, 1, -1000).token;
    const dead = await post({ Authorization: `Bearer ${expired}` }, { lat: 6.6745, lng: -1.5716 });
    assert.equal(dead.status, 401);
    assert.equal((await dead.json()).retoken, true);

    // No token and no session → not authenticated.
    const anon = await post({}, { lat: 6.6745, lng: -1.5716 });
    assert.equal(anon.status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
