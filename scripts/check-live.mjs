// Is the live Supabase database what the code says it is? (2026-11-22, a lesson from SDBE: code that never reached the live system
// looked done.) Read only. For every migration, it counts the functions the file defines and how many exist live, names any missing,
// and reports the council's size (a decision needs a majority of at least 3). Needs the project linked locally (`supabase link`).
//   npm run check:live
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = 'supabase/migrations';
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const s = readFileSync(`${dir}/${f}`, 'utf8');
  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:([a-z_]+)\.)?([a-z_]+)\s*\(/gi)) rows.push([f.slice(0, 4), m[1] ?? 'public', m[2]]);
}
const values = [...new Set(rows.map((r) => r.join('|')))].map((k) => `('${k.split('|').join("','")}')`).join(',\n');
const sql = `select e.mig, count(*) as defined, count(p.oid) as live, string_agg(case when p.oid is null then e.sch||'.'||e.fn end, ', ') as missing
from (values ${values}) e(mig, sch, fn)
left join pg_namespace n on n.nspname = e.sch
left join pg_proc p on p.proname = e.fn and p.pronamespace = n.oid
group by e.mig
union all select 'council', count(*), 0, null from answers.staff where role = 'council'
order by 1;`;
const file = '.check-live.sql';
writeFileSync(file, sql);
let out;
try { out = execFileSync('supabase', ['db', 'query', '--linked', '-f', file], { encoding: 'utf8' }); } finally { rmSync(file, { force: true }); }
const result = JSON.parse(out.slice(out.indexOf('{')));
let drift = false;
for (const r of result.rows ?? []) {
  if (r.mig === 'council') { console.log(`council members: ${r.defined}${Number(r.defined) < 3 ? '  (fewer than 3: no new use can be decided)' : ''}`); continue; }
  const ok = Number(r.defined) === Number(r.live);
  if (!ok) drift = true;
  console.log(`${r.mig}: ${r.live}/${r.defined} functions live${ok ? '' : `  MISSING: ${r.missing}`}`);
}
console.log(drift ? '\nThe live database is behind the code. Apply the missing migrations.' : '\nThe live database matches every migration.');
process.exitCode = drift ? 1 : 0;
