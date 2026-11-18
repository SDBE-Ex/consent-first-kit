// Database rules, tested on a real Postgres engine (PGlite) with every migration applied in order.
// Run: npm run test:sql
// The database is where the principles are enforced, so this is the test that matters most.
// Supabase provides roles and an `auth` schema; small stand-ins for both are created here.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

let failures = 0
let passes = 0
const ok = (name, cond) => {
  if (cond) passes++
  else failures++
  console.log(cond ? 'PASS' : 'FAIL', name)
}

async function freshDb(upTo = Infinity) {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;`)
  for (const f of files) {
    if (Number(f.slice(0, 4)) > upTo) break
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }
  return db
}
const q = async (db, sql, p) => {
  try {
    return { r: (await db.query(sql, p)).rows }
  } catch (e) {
    return { e: e.message }
  }
}
const as = (db, uid) => db.exec(`select set_config('app.uid','${uid ?? ''}',false)`)
const headers = (db, o) => db.exec(`select set_config('request.headers','${o ? JSON.stringify(o) : ''}',false)`)

async function leadAndPhone(db) {
  const lead = (await db.query("insert into auth.users(email) values('lead@x.org') returning id")).rows[0].id
  const stranger = (await db.query("insert into auth.users(email) values('s@x.org') returning id")).rows[0].id
  await db.query("insert into answers.staff(user_id,role) values($1,'lead')", [lead])
  return { lead, stranger }
}

// ---------- 0003: sync is safe to retry ----------
{
  console.log('\n== 0003: retries ==')
  const old = await freshDb(2)
  const sub = "select public.submit_answers('demo-wellbeing-check','AAAA-1111','en',true,false,false,'{\"q1\":\"x\"}')"
  await q(old, sub)
  ok('before 0003 a retry errors (the original bug)', (await q(old, sub)).e !== undefined)

  const db = await freshDb(3)
  await q(db, sub)
  ok('retry is a no-op', (await q(db, sub)).e === undefined)
  ok('still one response', (await db.query('select count(*)::int c from answers.responses')).rows[0].c === 1)
  await db.query("select public.update_consent('AAAA-1111',false,false,false)")
  await q(db, sub)
  ok('a retry does not undo a withdrawal', (await db.query('select withdrawn_at is not null w from answers.consents')).rows[0].w === true)
  ok('no consent given is refused', (await q(db, "select public.submit_answers('demo-wellbeing-check','BBBB-2222','en',false,false,false,'{}')")).e !== undefined)
  ok('unknown dataset is refused', (await q(db, "select public.submit_answers('nope','CCCC-3333','en',true,false,false,'{}')")).e !== undefined)
  ok('identity refused when the dataset declares none', (await q(db, "select public.submit_identity('AAAA-1111','{\"name\":\"x\"}')")).e !== undefined)
}

// ---------- 0004: enrolled phones ----------
{
  console.log('\n== 0004: device enrolment ==')
  const db = await freshDb(4)
  const { lead, stranger } = await leadAndPhone(db)
  const sub = (t, code) => q(db, "select public.submit_answers($1,'demo-wellbeing-check',$2,'en',true,false,false,'{\"q1\":\"x\"}')", [t, code])

  await as(db, stranger)
  ok('a non-lead cannot create a code', (await q(db, "select public.create_enrolment('A')")).e?.includes('only programme leads'))
  await as(db, lead)
  const code = (await q(db, "select public.create_enrolment('Ngozi phone') c")).r[0].c
  ok('code looks like XXXX-XXXX-XXXX', /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code))
  ok('the code itself is not stored', (await q(db, "select count(*)::int n from answers.enrolments where encode(code_hash,'hex') like '%'||replace($1,'-','')||'%'", [code])).r[0].n === 0)
  await as(db, null)
  ok('a wrong code returns null', (await q(db, "select public.redeem_enrolment('AAAA-BBBB-CCCC') t")).r[0].t === null)
  const token = (await q(db, 'select public.redeem_enrolment($1) t', [code.toLowerCase().replace(/-/g, ' ')])).r[0].t
  ok('the right code (any case or spacing) gives a token', typeof token === 'string' && token.length === 64)
  ok('a code works once', (await q(db, 'select public.redeem_enrolment($1) t', [code])).r[0].t === null)
  ok('the token is not stored in plain', (await q(db, "select count(*)::int n from answers.devices where encode(token_hash,'hex')=$1", [token])).r[0].n === 0)
  ok('no token is refused', (await sub(null, 'AAAA-1111')).e?.includes('device not enrolled'))
  ok('a wrong token is refused', (await sub('x'.repeat(64), 'AAAA-1111')).e?.includes('device not enrolled'))
  ok('an enrolled phone submits', (await sub(token, 'AAAA-1111')).e === undefined)
  ok('and a retry is a no-op', (await sub(token, 'AAAA-1111')).e === undefined)
  ok('last_seen is recorded', (await q(db, 'select last_seen_at is not null s from answers.devices')).r[0].s)
  ok('the old open signature is gone', (await q(db, "select public.submit_answers('demo-wellbeing-check','ZZZZ-1111','en',true,false,false,'{}')")).e !== undefined)
  ok('identity needs a token too', (await q(db, "select public.submit_identity(null,'AAAA-1111','{}')")).e?.includes('device not enrolled'))

  await as(db, lead)
  const code2 = (await q(db, "select public.create_enrolment('Old') c")).r[0].c
  await db.query("update answers.enrolments set expires_at = now() - interval '1 minute' where used_at is null")
  await as(db, null)
  ok('an expired code returns null', (await q(db, 'select public.redeem_enrolment($1) t', [code2])).r[0].t === null)

  await as(db, stranger)
  ok('a non-lead cannot list or revoke phones',
    (await q(db, 'select * from public.my_devices()')).e !== undefined && (await q(db, 'select public.revoke_device(gen_random_uuid())')).e !== undefined)
  await as(db, lead)
  const dev = (await q(db, 'select * from public.my_devices()')).r
  ok('a lead sees the phone, never its token', dev.length === 1 && !('token_hash' in dev[0]))
  await q(db, 'select public.revoke_device($1)', [dev[0].id])
  await as(db, null)
  ok('a revoked phone is refused', (await sub(token, 'BBBB-2222')).e?.includes('device not enrolled'))

  await db.exec('set role anon')
  ok('anon cannot read devices', (await q(db, 'select * from answers.devices')).e !== undefined)
  ok('anon cannot call require_device', (await q(db, "select answers.require_device('x')")).e !== undefined)
  await db.exec('reset role')
}

// ---------- 0005: rate limits ----------
{
  console.log('\n== 0005: rate limits ==')
  const db = await freshDb()
  const { lead } = await leadAndPhone(db)
  await as(db, lead)
  const code = (await q(db, "select public.create_enrolment('P') c")).r[0].c
  await as(db, null)
  await headers(db, { 'cf-connecting-ip': '9.9.9.9' })
  const token = (await q(db, 'select public.redeem_enrolment($1) t', [code])).r[0].t
  await q(db, "select public.submit_answers($1,'demo-wellbeing-check','GOOD-1111','en',true,true,false,'{}')", [token])

  await headers(db, { 'cf-connecting-ip': '1.1.1.1' })
  for (let i = 0; i < 10; i++) await q(db, "select * from public.get_consent('NOPE-0000')")
  ok('a guesser is blocked after 10 wrong lookups', (await q(db, "select * from public.get_consent('NOPE-0000')")).e?.includes('too many'))
  ok('and blocked even with a right code', (await q(db, "select * from public.get_consent('GOOD-1111')")).e?.includes('too many'))
  ok('and on update_consent', (await q(db, "select public.update_consent('GOOD-1111',false,false,false)")).e?.includes('too many'))
  await headers(db, { 'cf-connecting-ip': '2.2.2.2' })
  ok('a different person is not blocked', (await q(db, "select * from public.get_consent('GOOD-1111')")).r?.length === 1)
  ok('right lookups are not counted as failures', (await q(db, "select count(*)::int n from answers.rate_events where key='2.2.2.2'")).r[0].n === 0)
  ok('a right update works', (await q(db, "select public.update_consent('GOOD-1111',true,false,false)")).e === undefined)
  await q(db, "select public.update_consent('NOPE-1111',true,true,true)")
  ok('a wrong code on update counts as a failure', (await q(db, "select count(*)::int n from answers.rate_events where key='2.2.2.2'")).r[0].n === 1)
  await headers(db, { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' })
  ok('the last x-forwarded-for entry is the key (a spoofed first one is ignored)', (await q(db, 'select answers.client_key() k')).r[0].k === '7.7.7.7')
  await headers(db, null)
  ok('no headers falls back to "unknown"', (await q(db, 'select answers.client_key() k')).r[0].k === 'unknown')

  await headers(db, { 'cf-connecting-ip': '3.3.3.3' })
  for (let i = 0; i < 10; i++) await q(db, "select public.redeem_enrolment('0000-0000-0000')")
  ok('an enrolment guesser is blocked after 10', (await q(db, "select public.redeem_enrolment('0000-0000-0000')")).e?.includes('too many'))
  await as(db, lead)
  const code2 = (await q(db, "select public.create_enrolment('Q') c")).r[0].c
  await as(db, null)
  await headers(db, { 'cf-connecting-ip': '4.4.4.4' })
  ok('a real health worker still enrols while a guesser is blocked', typeof (await q(db, 'select public.redeem_enrolment($1) t', [code2])).r[0].t === 'string')

  await db.exec('delete from answers.rate_events')
  for (let i = 0; i < 200; i++) await db.query("insert into answers.rate_events(kind,key) values('enrol',$1)", ['ip' + i])
  await headers(db, { 'cf-connecting-ip': '5.5.5.5' })
  ok('the global ceiling stops a spread-out attack', (await q(db, "select public.redeem_enrolment('0000-0000-0000')")).e?.includes('too many'))
  await db.exec("delete from answers.rate_events; insert into answers.rate_events(kind,key,at) values('enrol','old', now() - interval '2 days')")
  await q(db, "select public.redeem_enrolment('0000-0000-0000')")
  ok('events older than a day are deleted', (await q(db, "select count(*)::int n from answers.rate_events where key='old'")).r[0].n === 0)

  await db.exec('set role anon')
  ok('anon cannot read rate_events', (await q(db, 'select * from answers.rate_events')).e !== undefined)
  ok('anon cannot call rate_fail', (await q(db, "select answers.rate_fail('lookup')")).e !== undefined)
  await db.exec('reset role')
}

// ---------- Principles that must hold in every state ----------
{
  console.log('\n== Principles ==')
  const db = await freshDb()
  ok('identity rows have no foreign key into answers', (await db.query(
    "select count(*)::int n from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace s on s.oid=t.relnamespace where s.nspname='identity' and c.contype='f'")).rows[0].n === 0)
  ok('answers.responses has no identity-looking column', (await db.query(
    "select count(*)::int n from information_schema.columns where table_schema='answers' and table_name='responses' and column_name ~* '(name|phone|address|email)'")).rows[0].n === 0)
  ok('a dataset needs a purpose of 10+ characters', (await q(db, "insert into answers.datasets(id,title,purpose,end_date) values('x','t','short',current_date + 30)")).e !== undefined)
  ok('a dataset needs a future end date', (await q(db, "insert into answers.datasets(id,title,purpose,end_date) values('y','t','a real purpose here',current_date)")).e !== undefined)
  await db.exec('set role anon')
  for (const t of ['answers.datasets', 'answers.consents', 'answers.responses', 'identity.people']) {
    ok(`anon has no direct access to ${t}`, (await q(db, `select * from ${t}`)).e !== undefined)
  }
  await db.exec('reset role')
}

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
