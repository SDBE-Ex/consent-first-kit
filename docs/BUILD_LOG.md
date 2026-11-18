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
