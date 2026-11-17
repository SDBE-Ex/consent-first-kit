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

## Structure

```
src/
  screens/FieldScreens.tsx   Journey B: health worker in the field (screens 4 to 9)
  screens/SetupScreens.tsx   Journey A: programme lead setup (screens 1 to 3)
  lib/localStore.ts          encrypted offline storage, identity split
  lib/sync.ts                sync to server via narrow RPCs
  lib/i18n.ts                English + Yoruba (Yoruba pending native translator)
supabase/migrations/         database schema and rules
```

## Not done yet

- Yoruba strings and recorded consent audio (native translator and voice needed; no machine translation for consent)
- Health worker sign-in (submit functions are open to anon for the prototype only)
- Journey C (check or change consent by SMS / USSD) and Journey D (council) beyond the database functions

## Licence

AGPL-3.0. See LICENSE.
