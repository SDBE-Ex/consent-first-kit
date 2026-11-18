-- 0004: health worker phones are enrolled by a programme lead; submitting needs an enrolled phone.
--
-- Why device enrolment and not a login per health worker: people's answers must be saved with no
-- signal and no email account, so nothing at the moment of saving can depend on signing in.
-- A lead enrols each phone once, online. Sync then proves the phone is enrolled. A lost phone is
-- revoked by the lead and can submit nothing further.
--
-- Hard rules kept: the database enforces this (not only the UI); no table access for app roles;
-- no identity is tied to a health worker or a phone in any answers row.

create table if not exists answers.enrolments (
  code_hash   bytea primary key,                       -- sha256 of the one-time code; the code itself is never stored
  label       text not null check (length(trim(label)) between 1 and 80),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table if not exists answers.devices (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,                          -- e.g. "Ngozi's phone": for the lead's list only
  token_hash   bytea not null unique,                  -- sha256 of the device token; the token lives only on the phone
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

-- Failed code guesses, to slow guessing down (see redeem_enrolment).
create table if not exists answers.enrol_failures (at timestamptz not null default now());

alter table answers.enrolments     enable row level security;
alter table answers.devices        enable row level security;
alter table answers.enrol_failures enable row level security;
-- No policies: app roles cannot read or write these tables directly.

-- ---------- Lead: create a one-time code for a new phone ----------
-- 12 hex characters (48 bits), valid 24 hours, single use. Shown once to the lead.
create or replace function public.create_enrolment(p_label text)
returns text
language plpgsql security definer set search_path = '' as $$
declare raw text; code text;
begin
  if public.my_role() is distinct from 'lead' then raise exception 'only programme leads can enrol phones'; end if;
  raw := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  code := substr(raw,1,4) || '-' || substr(raw,5,4) || '-' || substr(raw,9,4);
  insert into answers.enrolments (code_hash, label, created_by, expires_at)
  values (sha256(convert_to(raw, 'UTF8')), trim(p_label), auth.uid(), now() + interval '24 hours');
  return code;
end $$;

-- ---------- Phone: trade the code for a device token ----------
-- Returns the token, or null if the code is wrong, used or expired. (It returns null instead of
-- raising so that the failed guess is still recorded: an exception would roll it back.)
-- More than 20 failures in 10 minutes pauses enrolment for everyone: crude, but it keeps a
-- 48-bit code out of reach of guessing. Revisit with per-IP limits at the edge.
create or replace function public.redeem_enrolment(p_code text)
returns text
language plpgsql security definer set search_path = '' as $$
declare h bytea; e answers.enrolments; token text;
begin
  delete from answers.enrol_failures where at < now() - interval '1 day';
  if (select count(*) from answers.enrol_failures where at > now() - interval '10 minutes') >= 20 then
    raise exception 'too many attempts, try again in a few minutes';
  end if;
  h := sha256(convert_to(upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')), 'UTF8'));
  select * into e from answers.enrolments
   where code_hash = h and used_at is null and expires_at > now() for update;
  if not found then
    insert into answers.enrol_failures default values;
    return null;
  end if;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update answers.enrolments set used_at = now() where code_hash = h;
  insert into answers.devices (label, token_hash, created_by)
  values (e.label, sha256(convert_to(token, 'UTF8')), e.created_by);
  return token;
end $$;

-- ---------- Internal: is this an enrolled, un-revoked phone? ----------
create or replace function answers.require_device(p_token text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update answers.devices set last_seen_at = now()
   where token_hash = sha256(convert_to(coalesce(p_token,''), 'UTF8')) and revoked_at is null;
  if not found then raise exception 'device not enrolled'; end if;
end $$;
revoke all on function answers.require_device from public, anon, authenticated;

-- ---------- Write path: the same rules as 0003, plus an enrolled phone ----------
-- The old signatures (no token) are dropped, so there is no open door left behind.
drop function if exists public.submit_answers(text, text, text, boolean, boolean, boolean, jsonb);
drop function if exists public.submit_identity(text, jsonb);

create or replace function public.submit_answers(
  p_device_token text,
  p_dataset_id text, p_check_code text, p_lang text,
  p_consent_care boolean, p_consent_research boolean, p_consent_ai boolean,
  p_answers jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform answers.require_device(p_device_token);
  if not exists (select 1 from answers.datasets d where d.id = p_dataset_id and d.end_date >= current_date) then
    raise exception 'dataset missing or expired';
  end if;
  if not (p_consent_care or p_consent_research or coalesce(p_consent_ai, false)) then
    raise exception 'no consent given: nothing may be saved';
  end if;
  insert into answers.consents (check_code, dataset_id, lang, care, research, ai_training)
  values (p_check_code, p_dataset_id, p_lang, p_consent_care, p_consent_research, coalesce(p_consent_ai, false))
  on conflict (check_code) do nothing;
  insert into answers.responses (check_code, dataset_id, answers)
  values (p_check_code, p_dataset_id, p_answers)
  on conflict (check_code) do nothing;
end $$;

create or replace function public.submit_identity(p_device_token text, p_check_code text, p_identity jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare allowed text[];
begin
  perform answers.require_device(p_device_token);
  select d.identity_fields into allowed
  from answers.consents c join answers.datasets d on d.id = c.dataset_id
  where c.check_code = p_check_code;
  if allowed is null then raise exception 'unknown check code'; end if;
  if exists (select 1 from jsonb_object_keys(p_identity) k where not (k = any(allowed))) then
    raise exception 'identity field not allowed for this dataset';
  end if;
  insert into identity.people (check_code, identity) values (p_check_code, p_identity)
  on conflict (check_code) do nothing;
end $$;

-- ---------- Lead: see and revoke phones ----------
create or replace function public.my_devices()
returns table (id uuid, label text, created_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'lead' then raise exception 'only programme leads can see phones'; end if;
  return query select d.id, d.label, d.created_at, d.last_seen_at, d.revoked_at
                 from answers.devices d order by d.created_at desc;
end $$;

create or replace function public.revoke_device(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'lead' then raise exception 'only programme leads can revoke phones'; end if;
  update answers.devices set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

-- ---------- Grants ----------
revoke all on function public.create_enrolment, public.redeem_enrolment, public.submit_answers,
  public.submit_identity, public.my_devices, public.revoke_device from public;
grant execute on function public.create_enrolment, public.my_devices, public.revoke_device to authenticated;
grant execute on function public.redeem_enrolment, public.submit_answers, public.submit_identity to anon, authenticated;
