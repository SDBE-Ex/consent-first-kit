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
