// Validate plan JSON files against the canonical schema (default: /workspace/architecture/plan-schema.json).
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
const here = path.dirname(new URL(import.meta.url).pathname);
const schemaPath = process.env.PLAN_SCHEMA || (fs.existsSync('/workspace/architecture/plan-schema.json') ? '/workspace/architecture/plan-schema.json' : path.join(here, 'plan-schema.json'));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false });
const validate = ajv.compile(schema);
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(here, '../public/plans')).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => path.join(here, '../public/plans', f));
let bad = 0;
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const ok = validate(data);
  // referential checks the schema can't express
  const refs = [];
  const lv = new Set((data.levels || []).map((l) => l.id)), wl = new Set((data.walls || []).map((w) => w.id)), rm = new Set((data.rooms || []).map((r) => r.id));
  for (const w of data.walls || []) if (!lv.has(w.level)) refs.push(`wall ${w.id}: unknown level ${w.level}`);
  for (const r of data.rooms || []) if (!lv.has(r.level)) refs.push(`room ${r.id}: unknown level ${r.level}`);
  for (const o of data.openings || []) if (!wl.has(o.wall)) refs.push(`opening ${o.id}: unknown wall ${o.wall}`);
  for (const s of data.stairs || []) { if (!lv.has(s.fromLevel)) refs.push(`stairs ${s.id}: unknown fromLevel`); if (!lv.has(s.toLevel)) refs.push(`stairs ${s.id}: unknown toLevel`); }
  for (const x of data.furniture || []) if (!rm.has(x.room)) refs.push(`furniture ${x.type}: unknown room ${x.room}`);
  console.log(`${ok && !refs.length ? 'VALID  ' : 'INVALID'} ${path.basename(f)}`);
  if (!ok) { bad++; for (const e of validate.errors) console.log(`   schema: ${e.instancePath || '/'} ${e.message}`); }
  if (refs.length) { bad++; refs.forEach((r) => console.log('   ref: ' + r)); }
}
console.log(`schema: ${schemaPath}`);
process.exit(bad ? 1 : 0);
