'use strict';

process.env.VMTL_DB = ':memory:';
if (process.env.VMTL_TEST_FLEET_PG === '1') {
  process.env.DB_RUNTIME = 'postgres';
  process.env.PGLITE_DIR = 'memory://';
  delete process.env.DATABASE_URL;
} else {
  delete process.env.DB_RUNTIME;
}
process.env.SESSION_SECRET = 'upload-validation-test-secret';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const PDFDocument = require('pdfkit');
const session = require('express-session');
const db = require('../src/db/runtime');
const settings = require('../src/services/settings');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/util/password');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z', 'base64');
const webp = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAUAmJaQAA3AA/v02aAA=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function makePdf() {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const ended = once(doc, 'end');
  doc.text('Harmless upload fixture');
  doc.end();
  await ended;
  return Buffer.concat(chunks);
}

test('upload endpoints validate bytes, keep rejections private and safely retry accepted files', async t => {
  if (db.isPostgres()) {
    await db.ensureSchema();
    t.after(() => require('../src/db/postgres').close());
  }
  await db.run("INSERT INTO users(id,name,email,password_hash,is_super_admin,active) VALUES(1,'Fixture Owner','owner@test.example',?,1,1)", [hashPassword('Fixture#Pass1')]);
  await db.run("INSERT INTO org_units(id,name,type,path) VALUES(1,'Fixture Unit','unit','/1/')");
  await db.run("INSERT INTO vehicles(id,vehicle_number,registration_number,capacity,org_unit_id,status,active) VALUES(1,'V1','R1',10,1,'available',1)");
  await db.run("INSERT INTO maintenance_records(id,vehicle_id,maintenance_type,service_date) VALUES(1,1,'service','2026-01-01')");
  await db.run("INSERT INTO drivers(id,name,org_unit_id,status,active) VALUES(1,'Fixture Driver',1,'available',1)");
  await settings.set('feature_transport_schedule', '1');
  await settings.set('fleet_file_server', JSON.stringify({ maxMB: 1 }));
  await db.run("INSERT INTO ts_event_types(id,name) VALUES(1,'Fixture Type')");
  await db.run("INSERT INTO ts_events(id,event_type_id,title,org_unit_id) VALUES(1,1,'Fixture Event',1)");
  await db.run("INSERT INTO ts_centres(id,name) VALUES(1,'Fixture Centre')");
  await db.run('INSERT INTO ts_event_centres(event_id,centre_id,drivers_needed) VALUES(1,1,2)');
  await db.get('INSERT INTO ts_event_pool(event_id,driver_id) VALUES(1,1) RETURNING driver_id');

  const server = createApp({ sessionStore: new session.MemoryStore() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(base + '/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@test.example', password: 'Fixture#Pass1' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const request = (path, body, headers = {}, method = 'POST') => {
    if (body === undefined) return fetch(base + path, { headers: { cookie } });
    const raw = Buffer.isBuffer(body);
    return fetch(base + path, {
      method, headers: { cookie, 'content-type': raw ? 'application/octet-stream' : 'application/json', ...headers },
      body: raw ? body : JSON.stringify(body),
    });
  };
  const failed = async (response, status, code) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body.code, code);
    assert.ok(body.error);
  };
  const photo = '/fleet-files/vehicle/1/photo';
  const receipt = '/fleet-files/maintenance/1/receipt';
  const latest = '/fleet-files/vehicle/1/latest/photo';
  const pdf = await makePdf();

  await failed(await request(photo, { name: 'wrong.jpeg', data: png.toString('base64'), mime: 'image/jpeg', size: 3 }), 422, 'FILE_CONTENT');
  await failed(await request(photo, pdf, { 'x-file-name': 'letter.pdf' }), 422, 'FILE_EXTENSION');
  await failed(await request(photo, { name: 'garbled.png', data: 'a===' }), 422, 'FILE_ENCODING');
  await failed(await request(receipt, Buffer.from('%PDF-1.4\nx\n%%EOF\n'), { 'x-file-name': 'truncated.pdf' }), 422, 'FILE_CONTENT');
  await failed(await request(photo, Buffer.alloc(1048577), { 'x-file-name': 'oversized.png' }), 413, 'FILE_TOO_LARGE');
  await failed(await request(photo, { name: 'big.png', size: 1, data: Buffer.alloc(1048577).toString('base64') }), 422, 'FILE_TOO_LARGE');
  assert.equal((await request(latest)).headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM fleet_files')).n), 0);

  for (const [name, bytes, dest, mime] of [
    ['photo.JPG', jpeg, photo, 'image/jpeg'],
    ['photo.jpeg', jpeg, photo, 'image/jpeg'],
    ['photo.png', png, photo, 'image/png'],
    ['photo.webp', webp, photo, 'image/webp'],
    ['receipt.pdf', pdf, receipt, 'application/pdf'],
  ]) {
    const response = await request(dest, bytes, { 'x-file-name': name });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    const stored = await request(body.data.url.replace('/api', ''));
    assert.equal(stored.headers.get('content-type'), mime);
    assert.deepEqual(Buffer.from(await stored.arrayBuffer()), bytes);
  }

  const retry = { 'x-file-name': 'retry.png', 'x-op-id': 'shared-fixture-retry' };
  const [first, replay] = await Promise.all([request(photo, png, retry), request(photo, png, retry)]);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.deepEqual(await first.json(), await replay.json());
  await failed(await request(photo, Buffer.from('wrong'), retry), 422, 'FILE_CONTENT');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM fleet_files')).n), 6);

  const avatar = '/me/avatar';
  await failed(await request(avatar, { avatar: 'data:image/jpeg;base64,' + png.toString('base64') }), 422, 'FILE_CONTENT');
  const gifAvatar = 'data:image/gif;base64,' + gif.toString('base64');
  assert.equal((await request(avatar, { avatar: gifAvatar })).status, 200);
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=1')).avatar, gifAvatar);

  const role = await db.run("INSERT INTO roles(slug,name) VALUES('avatar-fixture','Avatar fixture')");
  const user = { name: 'Fixture Owner', email: 'owner@test.example', role_id: Number(role.lastInsertRowid) };
  const invalidAvatar = 'data:image/gif;base64,' + png.toString('base64');
  await failed(await request('/users', {
    ...user, email: 'another@test.example', password: 'Fixture#Pass1', avatar: invalidAvatar,
  }), 422, 'FILE_CONTENT');
  await failed(await request('/users/1', { ...user, avatar: invalidAvatar }, {}, 'PUT'), 422, 'FILE_CONTENT');
  await failed(await request('/users/1', { ...user, avatar: 'A'.repeat(700001) }, {}, 'PUT'), 422, 'FILE_TOO_LARGE');
  assert.equal((await db.get('SELECT avatar FROM users WHERE id=1')).avatar, gifAvatar);

  const schedule = '/ts/events/1/import-schedule';
  const csv = Buffer.from('\uFEFFName,Centre\r\n"Fixture Driver",Fixture Centre\r\n');
  await failed(await request(schedule, png, { 'x-file-name': 'fake.csv' }), 422, 'FILE_CONTENT');
  await failed(await request(schedule, csv, { 'x-file-name': 'fake.txt' }), 422, 'FILE_EXTENSION');
  await failed(await request(schedule, { csv: 'Name,Centre\n"Fixture Driver,Fixture Centre' }), 422, 'FILE_CONTENT');
  await failed(await request(schedule, Buffer.alloc(1048577), { 'x-file-name': 'large.csv' }), 413, 'FILE_TOO_LARGE');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM ts_assignments')).n), 0);
  const imported = await request(schedule, csv, { 'x-file-name': 'schedule.CSV' });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).data.imported, 1);
  const retried = await request(schedule, { csv: csv.toString() });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).data.imported, 0);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM ts_assignments')).n), 1);
});
