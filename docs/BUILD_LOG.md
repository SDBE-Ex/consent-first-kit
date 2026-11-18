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

**Client address.** `cf-connecting-ip` if present, else the last `x-forwarded-for` entry (added by the nearest proxy; a caller cannot choose it), else the shared key `unknown`, which behaves like the global limit. **Not yet verified against live Supabase**: after applying, make one wrong lookup and read `answers.rate_events` to confirm the key is a real address and not `unknown`.

**Test.** 15 checks on throwaway Postgres (PGlite): block after 10 wrong lookups, including with a right code and on `update_consent`; a different address is not blocked; right lookups are not counted; last `x-forwarded-for` entry wins over a spoofed first one; a real health worker can enrol while a guesser is blocked; the global ceiling works; old events are cleaned up; anon cannot read the table or call the helpers.

**Still open.** 8-character check codes are guessable in principle (about 10^12 combinations); the limit makes online guessing impractical but longer codes would be stronger. A check code is also a credential the person holds, so it should not be shared in a group chat (tell people this when giving the code).

## Idea under review (not built): using the kit with another form collector, such as Google Forms

See the decision note in the thread of 2026-11-18. Short version: Google Forms would put people's answers outside the kit, which breaks principles 2, 4 and 5. A consent-only "gate" in front of an external form is possible as an adoption bridge, labelled honestly as ungoverned, and an ODK or KoboToolbox connector fits the original plan ("consent and governance layer"). Neither is built before the 17 December letter.
