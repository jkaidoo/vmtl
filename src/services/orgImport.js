'use strict';

// "Import Departments": seed the full KNUST org-unit tree from the bundled
// college/faculty/department register (src/data/knust-org-structure.json, built
// from the UITS col_fac_dep sheet). The names are the same ones the Unified API
// returns per staff, so a seeded tree reconciles with later staff sign-ins
// instead of duplicating them (see the resolvers in ./orgUnits).
//
// The structure is: Institution → College/Directorate → (Faculty) → Department.
// Standalone units (halls, Transport, Library, …) have no college in the source,
// so their departments hang directly under the institution.
const db = require('./db_ref');
const orgUnits = require('./orgUnits');
const structure = require('../seed/knust-org-structure.json');

// Flatten the seed into the leaf department names and the grouping names, for a
// read-only preview and for totals.
function flatten() {
  const colleges = [];
  const directorates = [];
  const faculties = [];
  const departments = [];
  for (const g of structure.groups) {
    if (g.type === 'college') colleges.push(g.name);
    else if (g.type === 'directorate') directorates.push(g.name);
    for (const f of g.faculties || []) {
      faculties.push(f.name);
      for (const d of f.departments || []) departments.push(d);
    }
    for (const d of g.departments || []) departments.push(d);
  }
  return { colleges, directorates, faculties, departments };
}

async function nameSet(type) {
  const rows = await db.all('SELECT lower(name) AS n FROM org_units WHERE type = ? AND deleted_at IS NULL', [type]);
  return new Set(rows.map((r) => r.n));
}

// Read-only: what an import would create vs. keep. Department matching here is by
// name globally (the preview runs before any ancestor paths exist), which is the
// same signal run() uses as its fallback, so the counts line up.
async function plan() {
  const flat = flatten();
  const existingDepts = await nameSet('department');
  const existingBuckets = new Set([...(await nameSet('college')), ...(await nameSet('directorate'))]);
  const existingFac = await nameSet('faculty');
  const seedDepts = new Set(flat.departments.map((d) => d.toLowerCase()));
  const linkedDepts = [...seedDepts].filter((d) => existingDepts.has(d)).length;
  return {
    source: structure.source,
    institution: structure.institution,
    counts: {
      colleges: flat.colleges.length,
      directorates: flat.directorates.length,
      faculties: flat.faculties.length,
      departments: seedDepts.size,
    },
    departments_new: seedDepts.size - linkedDepts,
    departments_linked: linkedDepts,
    buckets_existing: [...flat.colleges, ...flat.directorates].filter((b) => existingBuckets.has(b.toLowerCase())).length,
    faculties_existing: flat.faculties.filter((f) => existingFac.has(f.toLowerCase())).length,
    has_institution: (await orgUnits.institutionId()) != null,
  };
}

async function unitCount() {
  const r = await db.get('SELECT COUNT(*) AS n FROM org_units WHERE deleted_at IS NULL');
  return r.n;
}

// Build (or reconcile) the whole tree. Idempotent: re-running links to what is
// already there and only creates the genuinely missing nodes.
async function run() {
  const before = await unitCount();
  const instId = await orgUnits.ensureInstitution(structure.institution, structure.institution_code);
  let colleges = 0;
  let directorates = 0;
  let faculties = 0;
  let departments = 0;

  for (const g of structure.groups) {
    let bucketId = instId;
    if (g.type === 'college') { bucketId = await orgUnits.resolveBucket(g.name, instId, { createType: 'college' }); colleges += 1; }
    else if (g.type === 'directorate') { bucketId = await orgUnits.resolveBucket(g.name, instId, { createType: 'directorate' }); directorates += 1; }
    // 'standalone' → departments hang directly under the institution (bucketId = instId)

    for (const f of g.faculties || []) {
      const facId = await orgUnits.resolveFaculty(f.name, bucketId);
      faculties += 1;
      for (const d of f.departments || []) { await orgUnits.resolveDepartment(d, { ancestorId: bucketId, parentId: facId }); departments += 1; }
    }
    for (const d of g.departments || []) { await orgUnits.resolveDepartment(d, { ancestorId: bucketId, parentId: bucketId }); departments += 1; }
  }

  const created = Math.max(0, (await unitCount()) - before);
  const processed = 1 + colleges + directorates + faculties + departments;
  return { created, linked: Math.max(0, processed - created), colleges, directorates, faculties, departments, institution_id: instId };
}

module.exports = { plan, run, flatten };
