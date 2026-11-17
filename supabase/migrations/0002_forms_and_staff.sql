-- 0002: programme-lead sign-in, form storage, and publish rules.
-- A form can only reach health workers' phones when:
--   - it has a purpose and an end date (0001 already enforces this),
--   - every question and consent line has a Yoruba version a human approved,
--   - the person publishing is a signed-in lead.

-- ---------- Staff roles ----------
-- Roles are granted by an admin in the SQL editor:
--   insert into answers.staff (user_id, role) select id, 'lead' from auth.users where email = 'someone@example.org';
create table if not exists answers.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('lead','reviewer','worker')),
  created_at timestamptz not null default now()
);
alter table answers.staff enable row level security;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select s.role from answers.staff s where s.user_id = auth.uid();
$$;

-- ---------- Form content ----------
-- questions: [{id, kind, en, yo, yo_approved, options:[{en, yo, yo_approved}]}]
-- consent:   [{id, en, yo, yo_approved}]   (the lines read before the first question)
alter table answers.datasets
  add column if not exists questions  jsonb not null default '[]',
  add column if not exists consent    jsonb not null default '[]',
  add column if not exists register   text  not null default 'formal' check (register in ('formal','casual')),
  add column if not exists status     text  not null default 'draft' check (status in ('draft','published','closed')),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

-- The demo stays usable as a published form.
update answers.datasets set status = 'published',
  consent = '[{"id":"c1","en":"You decide how your answers are used. You can say no to any part, and you can change your mind later.","yo":"","yo_approved":false}]'
where id = 'demo-wellbeing-check';

-- ---------- Every line approved? ----------
create or replace function answers.all_lines_approved(q jsonb, c jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_array_length(q) > 0
    and jsonb_array_length(c) > 0
    and not exists (select 1 from jsonb_array_elements(c) l
                    where coalesce((l->>'yo_approved')::boolean, false) = false or coalesce(l->>'yo','') = '')
    and not exists (select 1 from jsonb_array_elements(q) l
                    where coalesce((l->>'yo_approved')::boolean, false) = false or coalesce(l->>'yo','') = '')
    and not exists (select 1 from jsonb_array_elements(q) l, jsonb_array_elements(coalesce(l->'options','[]')) o
                    where coalesce((o->>'yo_approved')::boolean, false) = false or coalesce(o->>'yo','') = '');
$$;

-- ---------- Save a draft (create or update) ----------
create or replace function public.save_form(
  p_id text, p_title text, p_purpose text, p_end_date date,
  p_identity_fields text[], p_questions jsonb, p_consent jsonb, p_register text
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'lead' then raise exception 'only programme leads can save forms'; end if;
  if p_identity_fields is not null and not (p_identity_fields <@ array['name','phone','address']) then
    raise exception 'unknown identity field';
  end if;
  insert into answers.datasets (id, title, purpose, end_date, identity_fields, questions, consent, register, created_by)
  values (p_id, p_title, p_purpose, p_end_date, coalesce(p_identity_fields,'{}'), p_questions, p_consent, p_register, auth.uid())
  on conflict (id) do update
    set title = excluded.title, purpose = excluded.purpose, end_date = excluded.end_date,
        identity_fields = excluded.identity_fields, questions = excluded.questions,
        consent = excluded.consent, register = excluded.register, updated_at = now()
    where answers.datasets.status = 'draft';  -- published forms are frozen
  if not found then raise exception 'form is already published and cannot be edited'; end if;
  return p_id;
end $$;

-- ---------- Publish ----------
create or replace function public.publish_form(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare d answers.datasets;
begin
  if public.my_role() is distinct from 'lead' then raise exception 'only programme leads can publish'; end if;
  select * into d from answers.datasets where id = p_id;
  if not found then raise exception 'form not found'; end if;
  if d.end_date < current_date then raise exception 'end date has passed'; end if;
  if not answers.all_lines_approved(d.questions, d.consent) then
    raise exception 'every question, option and consent line needs an approved Yoruba version';
  end if;
  update answers.datasets set status = 'published', updated_at = now() where id = p_id;
end $$;

-- ---------- What phones download ----------
-- Form content only: no answers, no identity, no counts.
create or replace function public.published_forms()
returns table (id text, title text, purpose text, end_date date, identity_fields text[],
               questions jsonb, consent jsonb, register text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.title, d.purpose, d.end_date, d.identity_fields, d.questions, d.consent, d.register
  from answers.datasets d
  where d.status = 'published' and d.end_date >= current_date
  order by d.updated_at desc;
$$;

-- Leads see their own drafts to continue editing.
create or replace function public.my_forms()
returns table (id text, title text, purpose text, end_date date, identity_fields text[],
               questions jsonb, consent jsonb, register text, status text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.title, d.purpose, d.end_date, d.identity_fields, d.questions, d.consent, d.register, d.status
  from answers.datasets d
  where public.my_role() = 'lead' and d.created_by = auth.uid()
  order by d.updated_at desc;
$$;

revoke all on function public.my_role, public.save_form, public.publish_form,
  public.published_forms, public.my_forms from public;
grant execute on function public.my_role, public.save_form, public.publish_form, public.my_forms to authenticated;
grant execute on function public.published_forms to anon, authenticated;
