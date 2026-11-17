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
| Works offline on cheap Android | PWA service worker, IndexedDB, AES-GCM on device |

## Run locally

```bash
npm install
cp .env.example .env.local   # optional: works offline without it
npm run dev
```

## Set up the backend (Supabase)

1. Create a free project at supabase.com.
2. SQL Editor: run `supabase/migrations/0001_init.sql`.
3. Project Settings > API: copy URL and anon key into `.env.local`.
4. Database > Extensions: enable `pg_cron`, then run:
   `select cron.schedule('purge-expired', '0 2 * * *', 'select public.purge_expired()');`

## Programme leads (build and publish forms)

1. Open `/lead`, enter your email, click the sign-in link.
2. An admin grants the lead role once, in the Supabase SQL editor:
   `insert into answers.staff (user_id, role) select id, 'lead' from auth.users where email = 'you@example.org';`
3. Start from a template, edit, then **Save and review Yoruba**.
4. For each line, get drafts from African-made engines (Khaya first), edit, and tick **approved by a native speaker**.
5. **Publish**. The database refuses to publish until every line is approved. Published forms are frozen.

Translation runs in the `translate-draft` Edge Function (secret `KHAYA_API_KEY`), only for signed-in leads and reviewers, and only on form text, never on answers.

## Structure

```
src/
  screens/FieldScreens.tsx   Journey B: health worker in the field (screens 4 to 9)
  screens/LeadScreens.tsx    Journey A: sign-in, form builder, Yoruba review, publish
  lib/localStore.ts          encrypted offline storage, identity split
  lib/sync.ts                sync to server via narrow RPCs
  lib/i18n.ts                English + Yoruba (Yoruba pending native translator)
  lib/forms.ts               save/publish forms, translation drafts, register and tone-mark checks
supabase/migrations/         database schema and rules (0001 data, 0002 forms and staff)
supabase/functions/          translate-draft (Khaya translation + Yoruba speech)
```

## Not done yet

- Yoruba strings and recorded consent audio (native translator and voice needed; no machine translation for consent)
- Health worker sign-in (submit functions are open to anon for the prototype only; leads already sign in)
- Journey C (check or change consent by SMS / USSD) and Journey D (council) beyond the database functions

## Licence

AGPL-3.0. See LICENSE.
