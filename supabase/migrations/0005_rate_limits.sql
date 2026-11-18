-- 0005: rate limits on the two doors anyone can knock on without signing in.
--   1. Consent lookups by check code (get_consent, update_consent): the code is the only credential.
--   2. Phone enrolment (redeem_enrolment): the one-time code is the only credential.
--
-- Each limit counts FAILED attempts only, per client address, over 10 minutes, plus a much higher
-- global ceiling. This replaces the global-only limit in 0004, which one nuisance caller could use
-- to block every health worker from enrolling. A real person who mistypes a code is not affected.
--
-- The client address comes from the request headers PostgREST exposes. Cloudflare sets
-- cf-connecting-ip; otherwise the last x-forwarded-for entry (the one added by the nearest proxy,
-- which a caller cannot choose). If neither exists, all callers share the key 'unknown', which
-- makes the limit behave like the global one: safe, but blunt.

create table if not exists answers.rate_events (
  kind text not null,                 -- 'lookup' or 'enrol'
  key  text not null,                 -- client address (or 'unknown')
  at   timestamptz not null default now()
);
create index if not exists rate_events_kind_key_at on answers.rate_events (kind, key, at);
alter table answers.rate_events enable row level security;
-- No policies: app roles cannot read or write this table directly.

create or replace function answers.client_key()
returns text
language plpgsql stable set search_path = '' as $$
declare h json; xff text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  if h is null then return 'unknown'; end if;
  if coalesce(h->>'cf-connecting-ip', '') <> '' then return left(h->>'cf-connecting-ip', 64); end if;
  xff := coalesce(h->>'x-forwarded-for', '');
  if xff <> '' then
    return left(trim((regexp_split_to_array(xff, '\s*,\s*'))[array_length(regexp_split_to_array(xff, '\s*,\s*'), 1)]), 64);
  end if;
  return 'unknown';
end $$;

-- True when this client (or everyone together) has failed too often in the last 10 minutes.
create or replace function answers.rate_blocked(p_kind text, p_per_key int, p_global int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text := answers.client_key();
begin
  delete from answers.rate_events where at < now() - interval '1 day';
  return (select count(*) from answers.rate_events
           where kind = p_kind and key = k and at > now() - interval '10 minutes') >= p_per_key
      or (select count(*) from answers.rate_events
           where kind = p_kind and at > now() - interval '10 minutes') >= p_global;
end $$;

create or replace function answers.rate_fail(p_kind text)
returns void
language sql security definer set search_path = '' as $$
  insert into answers.rate_events (kind, key) values (p_kind, answers.client_key());
$$;
revoke all on function answers.client_key, answers.rate_blocked, answers.rate_fail from public, anon, authenticated;

-- ---------- Consent lookups ----------
-- A wrong code is recorded as a failure. (Returned, not raised: an exception would roll the record back.)
create or replace function public.get_consent(p_check_code text)
returns table (care boolean, research boolean, ai_training boolean, withdrawn boolean, purpose text, end_date date)
language plpgsql security definer set search_path = '' as $$
begin
  if answers.rate_blocked('lookup', 10, 300) then raise exception 'too many attempts, try again in a few minutes'; end if;
  return query
    select c.care, c.research, c.ai_training, c.withdrawn_at is not null, d.purpose, d.end_date
    from answers.consents c join answers.datasets d on d.id = c.dataset_id
    where c.check_code = p_check_code;
  if not found then perform answers.rate_fail('lookup'); end if;
end $$;

create or replace function public.update_consent(p_check_code text, p_care boolean, p_research boolean, p_ai boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if answers.rate_blocked('lookup', 10, 300) then raise exception 'too many attempts, try again in a few minutes'; end if;
  update answers.consents
     set care = p_care, research = p_research, ai_training = p_ai,
         withdrawn_at = case when not (p_care or p_research or p_ai) then now() else null end,
         updated_at = now()
   where check_code = p_check_code;
  if not found then perform answers.rate_fail('lookup'); end if;
end $$;
-- All choices set to no = withdrawn: answers are excluded from every future use and summary.

-- ---------- Enrolment: per client, with a high global ceiling ----------
create or replace function public.redeem_enrolment(p_code text)
returns text
language plpgsql security definer set search_path = '' as $$
declare h bytea; e answers.enrolments; token text;
begin
  if answers.rate_blocked('enrol', 10, 200) then
    raise exception 'too many attempts, try again in a few minutes';
  end if;
  h := sha256(convert_to(upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')), 'UTF8'));
  select * into e from answers.enrolments
   where code_hash = h and used_at is null and expires_at > now() for update;
  if not found then
    perform answers.rate_fail('enrol');
    return null;
  end if;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update answers.enrolments set used_at = now() where code_hash = h;
  insert into answers.devices (label, token_hash, created_by)
  values (e.label, sha256(convert_to(token, 'UTF8')), e.created_by);
  return token;
end $$;

-- Restated grants (CREATE OR REPLACE keeps them; this file stands on its own).
revoke all on function public.get_consent, public.update_consent, public.redeem_enrolment from public;
grant execute on function public.get_consent, public.update_consent, public.redeem_enrolment to anon, authenticated;
