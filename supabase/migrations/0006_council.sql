-- 0006: the community council decides every new use of the data (principle 6).
--
-- Who does what:
--   lead     files a request on behalf of someone who wants to use a dataset. Cannot decide.
--   council  votes. Cannot file, cannot build forms. Roles are exclusive (one role per user), so nobody
--            can both file and decide a request.
--   anyone   can read the list of DECIDED requests (who uses what, for what, on which conditions).
--
-- Rules, enforced here and not in the app:
--   - A request needs a stated purpose and a stated community benefit (20+ characters each).
--   - The council needs at least 3 members before it can decide anything.
--   - A decision needs a majority of the WHOLE council (not of those who happened to vote).
--     Approve, approve with conditions and reject are the only votes; every vote carries a written reason.
--   - A vote cannot be changed. A decided request cannot be changed.
--   - Approval never releases data. It only unlocks a COUNT of the records whose owners agreed to that kind
--     of use (principle 5: no raw copies leave the kit). Counts of 1 to 4 are hidden so a small number
--     cannot point at a person.
--   - Everything is written to an append-only access log. The log holds no answers and no identity.

-- ---------- Council role ----------
-- Granted by an admin in the SQL editor, like leads:
--   insert into answers.staff (user_id, role) select id, 'council' from auth.users where email = '...';
alter table answers.staff drop constraint if exists staff_role_check;
alter table answers.staff add constraint staff_role_check check (role in ('lead','reviewer','worker','council'));

-- ---------- Requests and votes ----------
alter table answers.use_requests add column if not exists filed_by uuid references auth.users(id);

create table if not exists answers.council_votes (
  request_id uuid not null references answers.use_requests(id) on delete cascade,
  member     uuid not null,
  vote       text not null check (vote in ('approve','approve_with_conditions','reject')),
  reason     text not null check (length(trim(reason)) >= 10),
  conditions text,
  at         timestamptz not null default now(),
  primary key (request_id, member),
  check (vote <> 'approve_with_conditions' or length(trim(coalesce(conditions,''))) >= 10)
);
alter table answers.council_votes enable row level security;

-- The access log keeps its history even after a dataset expires and is purged, so it must not point
-- at the request row by foreign key (the log holds no personal data: ids, actions and counts only).
alter table answers.access_log drop constraint if exists access_log_request_id_fkey;

-- ---------- Nothing decided or logged can be rewritten ----------
create or replace function answers.no_rewrite() returns trigger language plpgsql as $$
begin raise exception '% rows cannot be changed or deleted', tg_table_name; end $$;

drop trigger if exists access_log_append_only on answers.access_log;
create trigger access_log_append_only before update or delete on answers.access_log
  for each row execute function answers.no_rewrite();

drop trigger if exists votes_no_update on answers.council_votes;
create trigger votes_no_update before update on answers.council_votes
  for each row execute function answers.no_rewrite();

create or replace function answers.guard_request() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' then raise exception 'a decided request cannot be changed'; end if;
  if (new.dataset_id, new.requester, new.use_type, new.purpose, new.community_benefit)
     is distinct from (old.dataset_id, old.requester, old.use_type, old.purpose, old.community_benefit) then
    raise exception 'a request cannot be edited after it is filed';
  end if;
  return new;
end $$;
drop trigger if exists use_requests_guard on answers.use_requests;
create trigger use_requests_guard before update on answers.use_requests
  for each row execute function answers.guard_request();

create or replace function answers.log_event(p_request uuid, p_action text, p_detail jsonb default null)
returns void language sql set search_path = '' as $$
  insert into answers.access_log (request_id, actor, action, detail)
  values (p_request, coalesce(public.my_role(), 'unknown') || ':' || coalesce(auth.uid()::text, '-'), p_action, p_detail);
$$;

-- ---------- File a request (lead) ----------
create or replace function public.file_use_request(
  p_dataset_id text, p_requester text, p_use_type text, p_purpose text, p_community_benefit text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if public.my_role() is distinct from 'lead' then raise exception 'only programme leads can file a request'; end if;
  if p_use_type not in ('care','research','ai_training') then raise exception 'unknown kind of use'; end if;
  if length(trim(coalesce(p_requester,''))) < 3 then raise exception 'say who is asking'; end if;
  if length(trim(coalesce(p_purpose,''))) < 20 then raise exception 'describe the purpose (at least 20 characters)'; end if;
  if length(trim(coalesce(p_community_benefit,''))) < 20 then raise exception 'say how the community benefits (at least 20 characters)'; end if;
  if not exists (select 1 from answers.datasets d where d.id = p_dataset_id and d.end_date >= current_date) then
    raise exception 'dataset missing or ended';
  end if;
  insert into answers.use_requests (dataset_id, requester, use_type, purpose, community_benefit, filed_by)
  values (p_dataset_id, trim(p_requester), p_use_type, trim(p_purpose), trim(p_community_benefit), auth.uid())
  returning id into rid;
  perform answers.log_event(rid, 'filed', jsonb_build_object('dataset', p_dataset_id, 'use_type', p_use_type));
  return rid;
end $$;

-- ---------- Vote (council) ----------
-- Returns the request's status after this vote: 'pending' until one side holds a majority of the whole council.
create or replace function public.cast_vote(p_request_id uuid, p_vote text, p_reason text, p_conditions text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare r answers.use_requests; n int; major int; ap int; rj int; conds text; res text;
begin
  if public.my_role() is distinct from 'council' then raise exception 'only council members can vote'; end if;
  if p_vote not in ('approve','approve_with_conditions','reject') then raise exception 'unknown vote'; end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'give a reason (at least 10 characters)'; end if;
  if p_vote = 'approve_with_conditions' and length(trim(coalesce(p_conditions,''))) < 10 then
    raise exception 'state the conditions (at least 10 characters)';
  end if;
  select * into r from answers.use_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'this request is already decided'; end if;
  if not exists (select 1 from answers.datasets d where d.id = r.dataset_id and d.end_date >= current_date) then
    raise exception 'the dataset has ended';
  end if;
  select count(*) into n from answers.staff where role = 'council';
  if n < 3 then raise exception 'the council needs at least 3 members before it can decide'; end if;

  insert into answers.council_votes (request_id, member, vote, reason, conditions)
  values (p_request_id, auth.uid(), p_vote, trim(p_reason),
          case when p_vote = 'approve_with_conditions' then trim(p_conditions) end)
  on conflict do nothing;
  if not found then raise exception 'you have already voted on this request'; end if;
  perform answers.log_event(p_request_id, 'vote', jsonb_build_object('vote', p_vote));

  major := n / 2 + 1;
  select count(*) filter (where vote <> 'reject'), count(*) filter (where vote = 'reject')
    into ap, rj from answers.council_votes where request_id = p_request_id;

  if ap >= major then
    select string_agg(distinct conditions, E'\n') into conds
      from answers.council_votes where request_id = p_request_id and vote = 'approve_with_conditions';
    res := case when conds is null then 'approved' else 'approved_with_conditions' end;
    update answers.use_requests set status = res, conditions = conds, decided_at = now() where id = p_request_id;
    perform answers.log_event(p_request_id, 'decided', jsonb_build_object('status', res));
    return res;
  elsif rj >= major then
    update answers.use_requests set status = 'rejected', decided_at = now() where id = p_request_id;
    perform answers.log_event(p_request_id, 'decided', jsonb_build_object('status', 'rejected'));
    return 'rejected';
  end if;
  return 'pending';
end $$;

-- ---------- Council and leads read the queue (votes shown with reasons, never with who cast them) ----------
create or replace function public.council_requests()
returns table (id uuid, dataset_id text, dataset_title text, requester text, use_type text, purpose text,
               community_benefit text, status text, conditions text, created_at timestamptz, decided_at timestamptz,
               council_size int, majority int, votes jsonb, i_voted boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.dataset_id, d.title, r.requester, r.use_type, r.purpose, r.community_benefit, r.status,
         r.conditions, r.created_at, r.decided_at,
         (select count(*)::int from answers.staff where role = 'council'),
         (select count(*)::int / 2 + 1 from answers.staff where role = 'council'),
         coalesce((select jsonb_agg(jsonb_build_object('vote', v.vote, 'reason', v.reason, 'conditions', v.conditions)
                                    order by v.at) from answers.council_votes v where v.request_id = r.id), '[]'::jsonb),
         exists (select 1 from answers.council_votes v where v.request_id = r.id and v.member = auth.uid())
  from answers.use_requests r join answers.datasets d on d.id = r.dataset_id
  where public.my_role() in ('lead','council')
  order by (r.status = 'pending') desc, r.created_at desc;
$$;

-- ---------- Everyone can see what has been decided ----------
create or replace function public.public_decisions()
returns table (dataset_title text, requester text, use_type text, purpose text, status text,
               conditions text, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.title, r.requester, r.use_type, r.purpose, r.status, r.conditions, r.decided_at
  from answers.use_requests r join answers.datasets d on d.id = r.dataset_id
  where r.status <> 'pending'
  order by r.decided_at desc;
$$;

-- ---------- What an approval unlocks: a count, nothing else ----------
-- Only records whose owners agreed to this kind of use, who have not withdrawn, in a dataset that has not ended.
-- Counts of 1 to 4 return null so a small number cannot point at a person.
create or replace function public.eligible_records(p_request_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r answers.use_requests; n integer;
begin
  -- coalesce: a user with no role gives null, and null not in (...) would let them through
  if coalesce(public.my_role(), '') not in ('lead','council') then raise exception 'not allowed'; end if;
  select * into r from answers.use_requests where id = p_request_id;
  if not found then raise exception 'request not found'; end if;
  if r.status not in ('approved','approved_with_conditions') then raise exception 'this request is not approved'; end if;
  if not exists (select 1 from answers.datasets d where d.id = r.dataset_id and d.end_date >= current_date) then
    raise exception 'the dataset has ended';
  end if;
  select count(*) into n
    from answers.responses rs join answers.consents c on c.check_code = rs.check_code
   where rs.dataset_id = r.dataset_id and c.withdrawn_at is null
     and case r.use_type when 'care' then c.care when 'research' then c.research else c.ai_training end;
  perform answers.log_event(p_request_id, 'count_viewed', null);
  return case when n between 1 and 4 then null else n end;
end $$;

revoke all on function public.file_use_request, public.cast_vote, public.council_requests,
  public.public_decisions, public.eligible_records from public;
revoke all on function answers.log_event, answers.guard_request, answers.no_rewrite from public, anon, authenticated;
grant execute on function public.file_use_request, public.cast_vote, public.council_requests,
  public.eligible_records to authenticated;
grant execute on function public.public_decisions to anon, authenticated;
