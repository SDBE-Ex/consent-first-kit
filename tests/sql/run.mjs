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

// ---------- 0006: the council decides new uses ----------
{
  console.log('\n== 0006: council ==')
  const db = await freshDb()
  const { lead, stranger } = await leadAndPhone(db)
  const member = async (n) => {
    const id = (await db.query('insert into auth.users(email) values($1) returning id', [`c${n}@x.org`])).rows[0].id
    await db.query("insert into answers.staff(user_id,role) values($1,'council')", [id])
    return id
  }
  const [c1, c2, c3] = [await member(1), await member(2), await member(3)]
  const D = 'demo-wellbeing-check'
  const file = (use = 'research') => q(db, 'select public.file_use_request($1,$2,$3,$4,$5) id',
    [D, 'University of Ibadan', use, 'Study how common low mood is across the ward.', 'Results go back to the ward council and the clinic.'])
  const vote = async (who, id, v, reason = 'This is a clear and fair use.', cond = null) => {
    await as(db, who)
    return q(db, 'select public.cast_vote($1,$2,$3,$4) s', [id, v, reason, cond])
  }

  await as(db, stranger)
  ok('a non-lead cannot file a request', (await file()).e?.includes('only programme leads'))
  await as(db, c1)
  ok('a council member cannot file a request', (await file()).e?.includes('only programme leads'))
  await as(db, lead)
  ok('a request without a community benefit is refused',
    (await q(db, "select public.file_use_request($1,'Acme','research','Study how common low mood is.','too short')", [D])).e !== undefined)
  ok('a request for an unknown dataset is refused',
    (await q(db, "select public.file_use_request('nope','Acme','research','Study how common low mood is.','Results go back to the ward.')")).e?.includes('missing or ended'))
  ok('an unknown kind of use is refused',
    (await q(db, "select public.file_use_request($1,'Acme','sell','Study how common low mood is.','Results go back to the ward.')", [D])).e !== undefined)
  const r1 = (await file()).r[0].id
  ok('a lead can file a request', typeof r1 === 'string')
  ok('a lead cannot vote', (await vote(lead, r1, 'approve')).e?.includes('only council members'))
  await as(db, lead)
  ok('a filed request cannot be edited',
    (await q(db, "update answers.use_requests set purpose = 'something else entirely, quite different' where id = $1", [r1])).e?.includes('cannot be edited'))

  // With 3 members, 2 is the majority.
  ok('a vote needs a reason', (await vote(c1, r1, 'approve', 'ok')).e?.includes('reason'))
  ok('conditions are required for a conditional approval', (await vote(c1, r1, 'approve_with_conditions')).e?.includes('conditions'))
  ok('the first vote leaves it pending', (await vote(c1, r1, 'approve')).r?.[0].s === 'pending')
  ok('nobody can vote twice', (await vote(c1, r1, 'reject')).e?.includes('already voted'))
  ok('a vote cannot be changed in the table', (await q(db, "update answers.council_votes set vote = 'reject'")).e !== undefined)
  ok('a majority approves', (await vote(c2, r1, 'approve')).r?.[0].s === 'approved')
  ok('a decided request takes no more votes', (await vote(c3, r1, 'reject')).e?.includes('already decided'))
  ok('a decided request cannot be changed', (await q(db, "update answers.use_requests set status = 'rejected' where id = $1", [r1])).e?.includes('decided request'))

  await as(db, lead)
  const r2 = (await file()).r[0].id
  await vote(c1, r2, 'approve_with_conditions', 'Fine if the ward sees results first.', 'Share findings with the ward council before publishing.')
  ok('approval with a conditional vote is approved_with_conditions',
    (await vote(c2, r2, 'approve', 'Agree with the conditions set.')).r?.[0].s === 'approved_with_conditions')
  ok('the conditions are kept on the request',
    (await db.query('select conditions from answers.use_requests where id=$1', [r2])).rows[0].conditions.includes('ward council'))

  await as(db, lead)
  const r3 = (await file('ai_training')).r[0].id
  await vote(c1, r3, 'reject', 'No benefit to the community here.')
  ok('a majority rejects', (await vote(c3, r3, 'reject', 'We did not agree to AI training.')).r?.[0].s === 'rejected')
  await as(db, c1)
  ok('a rejected request unlocks nothing', (await q(db, 'select public.eligible_records($1)', [r3])).e?.includes('not approved'))

  await as(db, lead)
  const r4 = (await file()).r[0].id
  await vote(c1, r4, 'approve')
  ok('one approval out of three is still pending',
    (await db.query('select status from answers.use_requests where id=$1', [r4])).rows[0].status === 'pending')

  // A council of two cannot decide.
  const small = await freshDb()
  const sl = (await small.query("insert into auth.users(email) values('l@x.org') returning id")).rows[0].id
  await small.query("insert into answers.staff(user_id,role) values($1,'lead')", [sl])
  const m = []
  for (const n of [1, 2]) {
    const id = (await small.query('insert into auth.users(email) values($1) returning id', [`m${n}@x.org`])).rows[0].id
    await small.query("insert into answers.staff(user_id,role) values($1,'council')", [id])
    m.push(id)
  }
  await as(small, sl)
  const sr = (await q(small, "select public.file_use_request('demo-wellbeing-check','Acme','care','Study how common low mood is.','Results go back to the ward.') id")).r[0].id
  await as(small, m[0])
  ok('a council of fewer than 3 cannot decide', (await q(small, "select public.cast_vote($1,'approve','A clear and fair use.')", [sr])).e?.includes('at least 3'))

  // What an approval unlocks: a count of consenting records only.
  const seed = async (code, care, research, ai, withdrawn = false) => {
    await db.query("insert into answers.consents(check_code,dataset_id,lang,care,research,ai_training,withdrawn_at) values($1,$2,'en',$3,$4,$5,$6)",
      [code, D, care, research, ai, withdrawn ? new Date() : null])
    await db.query("insert into answers.responses(check_code,dataset_id,answers) values($1,$2,'{}')", [code, D])
  }
  for (let i = 0; i < 5; i++) await seed(`RES0-000${i}`, true, true, false)
  await seed('CARE-0001', true, false, false)
  await seed('GONE-0001', true, true, false, true)
  await as(db, c1)
  ok('the count includes only records whose owners agreed to research and have not withdrawn',
    (await q(db, 'select public.eligible_records($1) n', [r1])).r?.[0].n === 5)
  ok('a pending request unlocks nothing', (await q(db, 'select public.eligible_records($1)', [r4])).e?.includes('not approved'))
  await as(db, stranger)
  ok('a stranger cannot ask for a count', (await q(db, 'select public.eligible_records($1)', [r1])).e !== undefined)
  await db.query("delete from answers.responses where check_code in ('RES0-0003','RES0-0004')")
  await as(db, c1)
  ok('a count of 1 to 4 is hidden', (await q(db, 'select public.eligible_records($1) n', [r1])).r?.[0].n === null)

  // Views and the log.
  const list = (await q(db, 'select * from public.council_requests()')).r
  ok('council sees the queue, pending first', list.length === 4 && list[0].status === 'pending' && list[0].id === r4)
  ok('votes show reasons but not who cast them', list.every((x) => x.votes.every((v) => !('member' in v))) && !('member' in list[0]))
  ok('i_voted is true for my own votes', list.find((x) => x.id === r4).i_voted === true)
  await as(db, stranger)
  ok('a stranger sees no queue', (await q(db, 'select * from public.council_requests()')).r.length === 0)
  await as(db, null)
  await db.exec('set role anon')
  ok('anyone can see decided requests, and only those', (await q(db, 'select * from public.public_decisions()')).r?.length === 3)
  ok('anon cannot file, vote or read the queue',
    (await q(db, "select public.file_use_request('x','Acme','care','Study how common low mood is.','Results go back to the ward.')")).e !== undefined
    && (await q(db, "select public.cast_vote(gen_random_uuid(),'approve','A clear and fair use.')")).e !== undefined
    && (await q(db, 'select * from public.council_requests()')).e !== undefined)
  ok('anon cannot read votes or the log',
    (await q(db, 'select * from answers.council_votes')).e !== undefined && (await q(db, 'select * from answers.access_log')).e !== undefined)
  await db.exec('reset role')
  const log = (await db.query('select action, count(*)::int n from answers.access_log group by action')).rows
  const n = (a) => log.find((x) => x.action === a)?.n ?? 0
  ok('filing, voting, deciding and count views are all logged', n('filed') === 4 && n('vote') === 7 && n('decided') === 3 && n('count_viewed') >= 2)
  ok('the log holds no answers or identity', (await db.query("select count(*)::int n from answers.access_log where detail::text ~* '(name|phone|address|answers)'")).rows[0].n === 0)
  ok('the log cannot be edited', (await q(db, "update answers.access_log set action = 'x'")).e !== undefined)
  ok('the log cannot be deleted', (await q(db, 'delete from answers.access_log')).e !== undefined)
  await db.query("update answers.datasets set created_at = now() - interval '10 days', end_date = current_date - 1 where id = $1", [D])
  ok('purging an expired dataset still works and the log survives',
    (await q(db, 'select public.purge_expired() n')).e === undefined && (await db.query('select count(*)::int n from answers.access_log')).rows[0].n > 0)
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
