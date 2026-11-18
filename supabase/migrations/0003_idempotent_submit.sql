-- Make sync safe to retry.
-- Problem: submit_answers and submit_identity are two separate requests (answers and identity
-- never share a request body). If the first succeeded and the second failed, the phone retried
-- both, the first hit a duplicate key, and that record stayed on the phone forever.
-- Fix: both functions are idempotent. A retry changes nothing that already exists, and never
-- overwrites a consent choice the person has since changed or withdrawn (Journey C).

-- One response per check code. Safe on existing data: a check code can only have one consent
-- row, and 0001 inserted exactly one response alongside it.
create unique index if not exists responses_check_code_key on answers.responses (check_code);

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
  values (p_check_code, p_dataset_id, p_lang, p_consent_care, p_consent_research, coalesce(p_consent_ai, false))
  on conflict (check_code) do nothing;
  insert into answers.responses (check_code, dataset_id, answers)
  values (p_check_code, p_dataset_id, p_answers)
  on conflict (check_code) do nothing;
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
  insert into identity.people (check_code, identity) values (p_check_code, p_identity)
  on conflict (check_code) do nothing;
end $$;

-- CREATE OR REPLACE keeps the existing grants; restated so this file stands on its own.
revoke all on function public.submit_answers, public.submit_identity from public;
grant execute on function public.submit_answers, public.submit_identity to anon, authenticated;
