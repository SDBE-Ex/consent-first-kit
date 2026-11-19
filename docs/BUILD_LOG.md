# Build log

Repo copy of the decisions and tests behind the Consent-First Kit. The fuller product doc and log live in the Claude Doc linked from `CLAUDE.md`; paste new entries there from time to time.

## 2026-11-18: Sync is safe to retry (migration 0003)

**Problem.** `submit_answers` and `submit_identity` are separate requests on purpose (answers and identity never share a request body or table). If the first succeeded and the second failed, the phone retried both. The first then hit a duplicate key, so the record stayed on the phone and never cleared. `sync.ts` also skipped errors without saying so. A weak signal in the field makes this likely, so it had to be fixed before the timed field test.

**Decision.** Both functions are idempotent: a retry inserts nothing that already exists and never overwrites a consent choice the person has since changed or withdrawn. Added a unique index on `answers.responses (check_code)` so "one response per code" is enforced by the database. `sync.ts` now counts records that failed, and the Sync screen says how many stay on the phone.

**Test.** Run on a throwaway Postgres engine (PGlite) with 0001 and 0002 applied, plus stand-ins for Supabase's `auth` schema:
- Before 0003, retrying a submitted record raised an error (bug reproduced).
- After 0003 applied over existing rows: retry is a no-op, still one response, a withdrawal survives a retry, no-consent and missing/expired datasets are still refused, identity retry is a no-op, identity fields not declared by the dataset are still refused.

**Not changed.** The submit functions are still open to `anon` (prototype only). Health worker sign-in is the next item.

**To apply on Supabase.** Run `supabase/migrations/0003_idempotent_submit.sql` in the SQL editor. Safe on existing data: a check code has one consent row, and 0001 inserted exactly one response with it.

## 2026-11-18: Health worker phones are enrolled (migration 0004)

**Problem.** `submit_answers` and `submit_identity` were open to any anonymous caller (prototype only), so anyone who found the project URL and publishable key could write rows.

**Decision: enrol the phone, not the person.** Answers must be saved with no signal and no email account, so nothing at the moment of saving can depend on signing in. A programme lead enrols each phone once, online. Sync then proves the phone is enrolled. A lost phone is removed by the lead and can send nothing further. Considered and rejected: email magic-link login per health worker (needs email and signal on a cheap phone, and ties answers to a person).

**How it works.**
- Lead: "Health worker phones" panel creates a one-time code (12 hex characters, valid 24 hours, single use). Only the hash is stored.
- Phone: types the code once, online. The server returns a random device token; only its hash is stored. The phone keeps the token encrypted.
- `submit_answers` / `submit_identity` take the token and call `answers.require_device`, which refuses unknown or revoked tokens. The old signatures without a token are dropped, so no open door remains.
- No answers row records which phone or health worker collected it (principle 2). The devices table holds only a label the lead typed and `last_seen_at`.
- Code guessing: more than 20 wrong codes in 10 minutes pauses enrolment for everyone. Crude, and a nuisance attacker could block enrolment for a while. Revisit with per-IP limits at the edge before real use. A wrong code returns null instead of raising so the failure is recorded (an exception would roll the record back).
- An un-enrolled phone can still collect (principle 7); answers stay encrypted on the phone and send once it is enrolled. If the server says the phone was removed, sync stops, keeps every record and says so.

**Test.** 21 checks on throwaway Postgres (PGlite) with 0001 to 0004 applied: non-leads cannot create codes, list or revoke; the code is never stored; codes work once, expire and are not case or spacing sensitive; no token, wrong token and a revoked phone are refused; retries are still no-ops; old open signatures are gone; guessing is throttled; app roles cannot read the tables or call `require_device`.

**Not done.** Rate limit on `get_consent` / `update_consent`. A device token on the phone can be copied by someone with access to the unlocked browser profile; revocation is the answer.

**Rollout.** Apply `0004` on Supabase and deploy the app at the same time. Until a phone is enrolled, its sync reports "not enrolled" and keeps its records.

## 2026-11-18: Rate limits on the unauthenticated doors (migration 0005)

**Problem.** Two functions can be called by anyone, because the credential is a code: `get_consent` / `update_consent` (a check code, 8 characters from 32 letters and digits) and `redeem_enrolment` (a one-time code). 0004 limited enrolment guesses globally (20 in 10 minutes), which one nuisance caller could use to stop every health worker enrolling. Consent lookups had no limit.

**Decision.** Count failed attempts only, per client address, over 10 minutes: 10 allowed, then refused. A much higher global ceiling (300 lookups, 200 enrolments) still stops a spread-out attack. Successful lookups are never counted, so a person who mistypes once is not affected. Failures are returned, not raised, so the record is kept (an exception would roll it back). Events older than a day are deleted. App roles cannot read the table or call the helper functions.

**Client address.** `cf-connecting-ip` if present, else the last `x-forwarded-for` entry (added by the nearest proxy; a caller cannot choose it), else the shared key `unknown`, which behaves like the global limit. **Applied on Supabase 2026-11-18 (structure verified: table, 3 helpers, anon can run the public functions and cannot run the helpers). Client address not yet verified live**: there is no screen for consent lookups yet (Journey C is a mockup), so the check is to type one wrong code on the Enrol screen, then read `answers.rate_events` in the SQL editor. If `key` shows `unknown` rather than a real address, the limit behaves like the global ceiling only and the header name needs adjusting.

**Test.** 15 checks on throwaway Postgres (PGlite): block after 10 wrong lookups, including with a right code and on `update_consent`; a different address is not blocked; right lookups are not counted; last `x-forwarded-for` entry wins over a spoofed first one; a real health worker can enrol while a guesser is blocked; the global ceiling works; old events are cleaned up; anon cannot read the table or call the helpers.

**Still open.** 8-character check codes are guessable in principle (about 10^12 combinations); the limit makes online guessing impractical but longer codes would be stronger. A check code is also a credential the person holds, so it should not be shared in a group chat (tell people this when giving the code).

## 2026-11-18: The council decides new uses (migration 0006, Journey D)

**Problem.** Principle 6 was only a promise. 0001 had empty `use_requests` and `access_log` tables and nothing that could fill or decide them.

**Decisions.**
- **Separate roles.** `council` joins `lead`, `reviewer`, `worker`. A user has one role, so nobody can both file a request (lead) and decide it (council). Council members are granted in the SQL editor, like leads.
- **A majority of the whole council decides, not of those who voted.** With 3 members, 2 decide. Fewer than 3 members: the database refuses every vote, so a one-person "council" cannot approve anything. Approve, approve with conditions and reject are the only votes; each needs a written reason, and conditions are required for a conditional vote. Votes and decided requests cannot be changed.
- **Approval releases nothing.** It unlocks `eligible_records()`, a count of records whose owners agreed to that kind of use and have not withdrawn. Counts of 1 to 4 return null so a small number cannot point at a person. A real release path (aggregates, a view, a file) is a separate decision and is not built.
- **Public decisions.** `public_decisions()` (anon can call it) lists who may use what, for what purpose and on which conditions. Vote reasons are shown to leads and council but never with who cast them.
- **Append-only log.** Every filing, vote, decision and count view is written to `access_log`, which refuses updates and deletes. The log has no foreign key to requests, so it survives a dataset being purged. It holds ids, actions and counts only.
- Considered and rejected: letting the requester file directly (a public door needing its own rate limit and abuse handling; a lead files on their behalf for now).

**Bug the tests caught.** `eligible_records` first used `my_role() not in ('lead','council')`. A user with no role gives null, `null not in (...)` is null, and the guard did not fire, so a stranger could have asked for a count. Now `coalesce(my_role(), '')`. Watch for this shape in any role check.

**Test.** 38 new checks (88 in all) on PGlite: roles, quorum and majority, rejection, conditions, no double votes, no edits, the count rules, what anon can and cannot see, the log, and a purge that leaves the log intact.

**Not done.** Applying 0006 on Supabase and adding real council members (needs the owner). Council members have no way to be removed except the SQL editor. Votes are not deletable by a trigger because the foreign-key cascade on purge must work. A release path for approved data. Yoruba text on the council screens. Requesters filing for themselves.

## 2026-11-18: Journey C web screen (`/consent`)

**What.** A person types the check code they were given and sees their three choices, the dataset's purpose and its end date. They can change any choice. All three set to no withdraws the answers (the database already did this). No sign-in and no name. The code is accepted in lower case, with spaces, or without the dash (`normaliseCode`). Code: `src/lib/consentCheck.ts`, `src/screens/ConsentCheck.tsx`. No migration: it uses `get_consent` and `update_consent` from 0001 and the limits from 0005.

**Not done.** SMS and USSD. That needs a telecom aggregator (Africa's Talking is the likely one), a number, a paid account and an Edge Function webhook, so it is the owner's decision first. A text-message link could open `/consent` today. The screen has no Yoruba text yet. The code is a credential: tell people not to share it.

## Idea under review (not built): using the kit with another form collector, such as Google Forms

See the decision note in the thread of 2026-11-18. Short version: Google Forms would put people's answers outside the kit, which breaks principles 2, 4 and 5. A consent-only "gate" in front of an external form is possible as an adoption bridge, labelled honestly as ungoverned, and an ODK or KoboToolbox connector fits the original plan ("consent and governance layer"). Neither is built before the 17 December letter. Decision (owner, 2026-11-18): leave it as a roadmap line, with the ODK/Kobo connector as the fellowship-year item.

## 2026-11-18: Database tests kept in the repo, CI on every push

The checks used while building 0003 to 0005 were throwaway scripts. They are now `tests/sql/run.mjs` (`npm run test:sql`, 50 checks, PGlite, every migration applied in order, plus the principles that must hold in every state: no foreign key from identity into answers, no identity-looking column in responses, purpose and end date required, anon has no direct table access). `.github/workflows/checks.yml` runs build, oxlint and test:sql on every push and pull request. First run passed. Rule going forward: every SQL change adds a check.
