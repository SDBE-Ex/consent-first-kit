# Consent-First Kit

Consent-first health data collection, owned by the communities who share it.

A health data collection kit for community health workers in Ibadan that stops misuse before it happens: it collects less, gets real consent first (Yoruba and English), and lets a community council decide who uses the data.

> **Prototype. Dummy data only.** No real health data may enter this system until a host organisation, an ethics process and a data protection impact assessment (Nigeria Data Protection Act 2023) are in place.

## Principles enforced in code

| Principle | Where |
| --- | --- |
| Collect less: answers never sit next to identity | `src/lib/localStore.ts` (separate encrypted stores), `identity` schema in SQL |
| Consent before the first question, three separate choices, AI training off by default | `src/screens/FieldScreens.tsx`, `answers.consents` |
| Purpose and end date on every dataset; expired data purged | `answers.datasets`, `purge_expired()` |
| No raw copies leave the kit | No export endpoints; app roles have no table access |
| Only enrolled phones can send answers | `answers.devices`, `redeem_enrolment()`, `require_device()` (migration 0004) |
| Guessing codes is slowed down | Per-address limits on consent lookups and enrolment (migration 0005) |
| The community decides new uses | Council votes, public decisions, append-only access log (migration 0006, `src/screens/CouncilScreens.tsx`) |
| Works offline on cheap Android | PWA service worker, IndexedDB, AES-GCM on device |

## Run locally

```bash
npm install
cp .env.example .env.local   # optional: works offline without it
npm run dev
```

## Set up the backend (Supabase)

1. Create a free project at supabase.com.
2. SQL Editor: run every file in `supabase/migrations/` in order (`0001` to `0005`). Each is safe to run once; `tests/sql/run.mjs` shows what each one guarantees.
3. Project Settings > API: copy URL and publishable (anon) key into `.env.local`.
4. Database > Extensions: enable `pg_cron`, then run:
   `select cron.schedule('purge-expired', '0 2 * * *', 'select public.purge_expired()');`

## Programme leads (build and publish forms)

1. Open `/lead`, enter your email, click the sign-in link.
2. An admin grants the lead role once, in the Supabase SQL editor:
   `insert into answers.staff (user_id, role) select id, 'lead' from auth.users where email = 'you@example.org';`
3. Start from a template, edit, then **Save and review Yoruba**.
4. For each line, get drafts from African-made engines (Khaya first), edit, and tick **approved by a native speaker**.
5. **Publish**. The database refuses to publish until every line is approved. Published forms are frozen.

Draft engines (form text only, never answers):

- **Khaya** (GhanaNLP, Ghana) via the `translate-draft` Edge Function (secret `KHAYA_API_KEY`), signed-in leads and reviewers only.
- **Adelani m2m100** (Nigeria) runs in the lead's browser with Transformers.js. Convert it once with `notebooks/convert_adelani_model.ipynb` (free Colab), then set `VITE_LOCAL_YO_MODEL` in Vercel.

## Health workers (collect in the field)

1. A programme lead opens `/lead`, goes to **Health worker phones**, types who the phone belongs to and taps **Create a code**.
2. The health worker opens the app on that phone, taps **Enrol this phone** and types the code once, with signal. It works once and expires after 24 hours.
3. After that the phone collects with no signal at all. Answers are encrypted on the phone and sent when it next has signal.
4. A lost phone: the lead removes it from the same panel, and it can send nothing further.

No answer records which phone or health worker collected it.

## Tests

```bash
npm run build      # typecheck and build
npx oxlint src
npm run test:sql   # database rules on a real Postgres engine (PGlite), every migration applied in order
```

The database is where the principles are enforced, so `test:sql` is the test that matters most.

## Structure

```
src/
  screens/FieldScreens.tsx   Journey B: health worker in the field (screens 4 to 9)
  screens/LeadScreens.tsx    Journey A: sign-in, form builder, Yoruba review, publish
  lib/localStore.ts          encrypted offline storage, identity split
  lib/sync.ts                sync to server via narrow, retry-safe RPCs
  lib/devices.ts             phone enrolment (codes, device list, remove a phone)
  lib/i18n.ts                English + Yoruba (Yoruba pending native translator)
  lib/forms.ts               save/publish forms, translation drafts, register and tone-mark checks
supabase/migrations/         database schema and rules (0001 data, 0002 forms and staff, 0003 retry-safe
                             submit, 0004 phone enrolment, 0005 rate limits)
tests/sql/                   database tests
docs/                        build log and the timed field test protocol
supabase/functions/          translate-draft (Khaya translation + Yoruba speech)
```

## Not done yet

- Yoruba strings and recorded consent audio (native translator and voice needed; no machine translation for consent)
- Journey C by SMS / USSD: the web screen `/consent` exists; the telecom gateway does not
- Council: migration 0006 is not yet applied on Supabase and no council members exist; no release path for approved data
- The timed field test against Google Forms, and the native speaker's review of the Yoruba lines (see `docs/`)
- Per-address limits depend on Supabase passing the caller's address to the database; the fallback is a shared limit (see `docs/BUILD_LOG.md`)
- Later: connectors to open collection tools such as ODK and KoboToolbox

## Licence

AGPL-3.0. See LICENSE.
