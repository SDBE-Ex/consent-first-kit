-- Consent-First Kit: initial schema
-- Principles enforced in the database, not just the UI:
--   2. Identity lives in its own schema, linked to answers only by a random check code.
--   3. Consent is three separate choices; AI training defaults to false.
--   4. Every dataset has a purpose and an end date; expired data is purged.
--   5. No direct table access for app roles: writes go through narrow functions, reads through approved views later.

create schema if not exists answers;
create schema if not exists identity;

-- Nobody reads these schemas directly from the app.
revoke all on schema answers, identity from anon, authenticated;

-- ---------- Datasets (principle 4) ----------
create table answers.datasets (
  id          text primary key,
  title       text not null,
  purpose     text not null check (length(trim(purpose)) >= 10),
  end_date    date not null check (end_date > created_at::date),
  identity_fields text[] not null default '{}',   -- only fields the lead confirmed are needed
  created_at  timestamptz not null default now()
);

-- ---------- Consent (principle 3) ----------
create table answers.consents (
  check_code   text primary key,
  dataset_id   text not null references answers.datasets(id) on delete cascade,
  lang         text not null check (lang in ('en','yo')),
  care         boolean not null default false,
  research     boolean not null default false,
  ai_training  boolean not null default false,
  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- Answers (no identity columns, ever) ----------
create table answers.responses (
  id          uuid primary key default gen_random_uuid(),
  check_code  text not null references answers.consents(check_code) on delete cascade,
  dataset_id  text not null references answers.datasets(id) on delete cascade,
  answers     jsonb not null,
  created_at  timestamptz not null default now()
);

-- ---------- Identity vault (separate schema, no foreign key into answers) ----------
create table identity.people (
  check_code  text primary key,
  identity    jsonb not null,
  created_at  timestamptz not null default now()
);

-- ---------- Council and access log (principle 6) ----------
create table answers.use_requests (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    text not null references answers.datasets(id) on delete cascade,
  requester     text not null,
  use_type      text not null check (use_type in ('care','research','ai_training')),
  purpose       text not null,
  community_benefit text not null,
  status        text not null default 'pending' check (status in ('pending','approved','approved_with_conditions','rejected')),
  conditions    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table answers.access_log (
  id          bigserial primary key,
  request_id  uuid references answers.use_requests(id),
  actor       text not null,
  action      text not null,
  detail      jsonb,
  at          timestamptz not null default now()
);

alter table answers.datasets     enable row level security;
alter table answers.consents     enable row level security;
alter table answers.responses    enable row level security;
alter table answers.use_requests enable row level security;
alter table answers.access_log   enable row level security;
alter table identity.people      enable row level security;
-- No policies are created: app roles cannot select, update or delete rows directly.

-- ---------- Write path (called by the field app's sync) ----------
create or replace function public.submit_answers(
  p_dataset_id text, p_check_code text, p_lang text,
  p_consent_care boolean, p_consent_research boolean, p_consent_ai boolean,
  p_answers jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from answers.datasets d where d.id = p_dataset_id and d.end_date >= current_date) then
    raise exception 'dataset missing or expired';
  end if;
  if not (p_consent_care or p_consent_research or coalesce(p_consent_ai, false)) then
    raise exception 'no consent given: nothing may be saved';
  end if;
  insert into answers.consents (check_code, dataset_id, lang, care, research, ai_training)
  values (p_check_code, p_dataset_id, p_lang, p_consent_care, p_consent_research, coalesce(p_consent_ai, false));
  insert into answers.responses (check_code, dataset_id, answers)
  values (p_check_code, p_dataset_id, p_answers);
end $$;

create or replace function public.submit_identity(p_check_code text, p_identity jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare allowed text[];
begin
  select d.identity_fields into allowed
  from answers.consents c join answers.datasets d on d.id = c.dataset_id
  where c.check_code = p_check_code;
  if allowed is null then raise exception 'unknown check code'; end if;
  -- Reject any identity field the dataset did not declare as needed.
  if exists (select 1 from jsonb_object_keys(p_identity) k where not (k = any(allowed))) then
    raise exception 'identity field not allowed for this dataset';
  end if;
  insert into identity.people (check_code, identity) values (p_check_code, p_identity);
end $$;

-- ---------- Consent check / change (Journey C) ----------
create or replace function public.get_consent(p_check_code text)
returns table (care boolean, research boolean, ai_training boolean, withdrawn boolean, purpose text, end_date date)
language sql security definer set search_path = '' as $$
  select c.care, c.research, c.ai_training, c.withdrawn_at is not null, d.purpose, d.end_date
  from answers.consents c join answers.datasets d on d.id = c.dataset_id
  where c.check_code = p_check_code;
$$;

create or replace function public.update_consent(p_check_code text, p_care boolean, p_research boolean, p_ai boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update answers.consents
     set care = p_care, research = p_research, ai_training = p_ai,
         withdrawn_at = case when not (p_care or p_research or p_ai) then now() else null end,
         updated_at = now()
   where check_code = p_check_code;
end $$;
-- All choices set to no = withdrawn: answers are excluded from every future use and summary.

-- ---------- Expiry (principle 4) ----------
create or replace function public.purge_expired()
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from identity.people p
   using answers.consents c, answers.datasets d
   where p.check_code = c.check_code and c.dataset_id = d.id and d.end_date < current_date;
  delete from answers.datasets d where d.end_date < current_date;  -- cascades to consents and responses
  get diagnostics n = row_count;
  return n;
end $$;

-- PROTOTYPE ONLY: anon may submit. Before any real data, restrict to authenticated health workers.
revoke all on function public.submit_answers, public.submit_identity, public.get_consent,
  public.update_consent, public.purge_expired from public;
grant execute on function public.submit_answers, public.submit_identity to anon, authenticated;
grant execute on function public.get_consent, public.update_consent to anon, authenticated;
-- purge_expired is run by the scheduler only (see README: enable pg_cron).

-- Demo dataset (dummy data only)
insert into answers.datasets (id, title, purpose, end_date)
values ('demo-wellbeing-check', 'Demo: community wellbeing check',
        'Demo only: test the consent and collection flow with dummy answers.', date '2027-01-31');
