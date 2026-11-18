# CLAUDE.md: Consent-First Kit

Context for coding agents working in this repo. Read fully before changing anything.

## What this is

A consent-first health data collection kit for community health workers in Ibadan, Nigeria. It stops misuse of health data **at the point of collection**: it collects less, gets real consent first (Yoruba and English), and lets a community council decide any new use.

Built by Philips Adebayo as the prototype for a **Mozilla Foundation Fellowship 2027/2028, Track I (Embedded)** application with host **Slum & Rural Health Initiative (SRHIN)**, Ibadan. SRHIN's stated challenge: mental health data from African communities is used to build AI without consent, community control or benefit-sharing. Letter of intent deadline: **17 December 2026, 11:59 PM Pacific**.

The product doc and build log (decisions, tests, open items) live in a Claude Doc: https://claude.ai/artifact/3z2M2vCqd1MKnbPt5Endha

## Non-negotiable principles

Every change must keep all seven. If a feature breaks one, the feature changes.

1. **Faster than Google Forms** for a health worker, or it will not be used.
2. **Collect less.** Health answers never sit next to name or phone. Identity is optional, stored in a separate schema, linked only by a random check code.
3. **Consent before the first question.** Three separate choices: care, research, AI training. AI training defaults to **no**.
4. **Every dataset has a purpose and an end date.** Expired data is deleted by a nightly job.
5. **No raw copies leave the kit.** No export endpoints; app roles have no direct table access.
6. **The community decides new uses** (council workflow, not built yet).
7. **Works offline on cheap Android.**

Hard rules:
- **People's answers never go to any AI or translation service.** Translation is only for form text at setup time.
- **No AI agents in the path of health data** (decision 12; Vercel eve was considered and rejected for this project).
- **Machine Yoruba is a draft.** A native speaker approves every line; the database refuses to publish otherwise.
- **Dummy data only** until SRHIN, an ethics process and a DPIA (Nigeria Data Protection Act 2023) are in place.
- Rules are enforced **in the database**, not only in the UI.

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Field app + lead tools | React 19 + Vite PWA (TypeScript), react-router | `src/` |
| Offline storage | IndexedDB via `idb`, AES-GCM with a non-extractable device key; answers and identity in separate stores | `src/lib/localStore.ts` |
| Backend | Supabase (Postgres, auth, RLS, Edge Functions), project `ukhlghwqycmsovbqoygl`, EU West | `supabase/` |
| Hosting | Vercel project `consent-first-kit` (team SDBE Outreach Engine), auto-deploys `main` | https://consent-first-kit.vercel.app |
| Translation engine 1 | Khaya / GhanaNLP (Ghana), Translation v2 `eng-yor` + TTS v2 `yor`, via Edge Function `translate-draft` | `supabase/functions/translate-draft/` |
| Translation engine 2 | Adelani `Davlan/m2m100_418M-eng-yor-mt` (Nigeria), run **in the lead's browser** with Transformers.js | `src/lib/localTranslate*.ts`, `notebooks/` |

Key files:
- `supabase/migrations/0001_init.sql`: data schemas (`answers`, `identity`), consent, submit/check/purge functions.
- `supabase/migrations/0002_forms_and_staff.sql`: staff roles, form content, `save_form`, `publish_form` (requires every line `yo_approved`), `published_forms`, `my_forms`.
- `src/screens/FieldScreens.tsx`: Journey B (health worker). `src/screens/LeadScreens.tsx`: Journey A (sign-in, builder, Yoruba review, publish).
- `src/lib/forms.ts`: form API, `registerFlag` (flags mixed casual/respectful "you"), `hasToneMarks`.

## Secrets and config (names only; never commit values)

- Vercel env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key), `VITE_LOCAL_YO_MODEL` = `Philips101/m2m100_418M-eng-yor-mt-onnx`.
- Supabase Edge Function secret: `KHAYA_API_KEY` (Khaya Developer plan, free, 100 calls/month).
- Colab secret: `Hugging_face_key` (write token). Code reads it **by name**; never paste a token into a cell or chat.
- Staff roles are granted in the Supabase SQL editor: `insert into answers.staff (user_id, role) select id, 'lead' from auth.users where email = '...';`

## Commands

```bash
npm install
npm run dev        # local dev; works offline without Supabase env
npm run build      # typecheck + build; must pass before pushing
npx oxlint src
```

Test database rules against a throwaway Postgres 16 before running migrations on Supabase (see build log for the stand-in `auth` schema used).

## Status (18 Nov 2026)

Done: field app live, sync verified in DB, lead sign-in + builder + Yoruba review + publish rules, Khaya live, Adelani published as `Philips101/m2m100_418M-eng-yor-mt-onnx` and drafting in the browser, $0/month.

Open, in priority order:
1. Licence check with David Adelani for the published ONNX copy (base model has no licence tag; training data is non-commercial). The copy has **no cached decoding**, so `localTranslate.worker.ts` runs its own full-sequence greedy loop; do not switch back to `pipeline()`/`generate()` (returns empty drafts). A cached export would make drafts faster.
2. Native speaker reviews the 13 lines of the "Community wellbeing check" draft; publish.
3. Timed field test with 3 to 5 health workers (kit vs Google Forms). Real numbers feed the letter.
4. Health worker sign-in (submit RPCs are open to `anon` for the prototype only).
5. Vulavula (Lelapa AI) as third draft engine; Journey C (SMS/USSD consent check); Journey D (council).

## Working conventions

- Explain the reasoning behind structural decisions; log each new decision in the build log.
- Never fabricate numbers or stories in copy. Unconfirmed figures stay in [brackets].
- In user-facing copy: no em dashes, plain direct language, Philips's own voice.
- Prefer free and open, African-made tools first; global tools as fallback.
- Commit messages: short, imperative. Keep `main` deployable; Vercel deploys every push.
