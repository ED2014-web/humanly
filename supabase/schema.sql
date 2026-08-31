create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 3 and 2000),
  image_path text,
  status text not null default 'open' check (status in ('open','answered','hidden')),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 4000),
  image_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  answer_id uuid references public.answers(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  check ((question_id is not null) <> (answer_id is not null))
);

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.reports enable row level security;

-- Recréer les politiques permet de rejouer ce script sur une base déjà initialisée.
create or replace function public.can_read_question(question_uuid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.questions q
    where q.id = question_uuid
      and (
        q.status = 'open'
        or q.author_id = auth.uid()
        or exists (select 1 from public.answers a where a.question_id = q.id and a.author_id = auth.uid())
      )
  );
$$;
revoke all on function public.can_read_question(uuid) from public;
grant execute on function public.can_read_question(uuid) to anon, authenticated;

drop policy if exists "profiles are public" on public.profiles;
drop policy if exists "users create their profile" on public.profiles;
drop policy if exists "users update their profile" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
create policy "users create their profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update their profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "anyone reads visible questions" on public.questions;
drop policy if exists "signed in users ask" on public.questions;
drop policy if exists "authors update questions" on public.questions;
create policy "anyone reads visible questions" on public.questions for select using (public.can_read_question(id));
create policy "signed in users ask" on public.questions for insert with check (
  auth.uid() = author_id
  and status = 'open'
  and claimed_by is null
  and claimed_until is null
  and (image_path is null or (
    (storage.foldername(image_path))[1] = 'questions'
    and (storage.foldername(image_path))[2] = auth.uid()::text
  ))
);
-- Les questions ne sont plus modifiables directement par le navigateur. Les changements sensibles passent par une fonction contrôlée.
create or replace function public.create_question(question_text text, question_image_path text default null)
returns public.questions
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.questions;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(trim(coalesce(question_text, ''))) < 3 or char_length(trim(question_text)) > 2000 then raise exception 'QUESTION_INVALID'; end if;
  if question_image_path is not null and (
    (storage.foldername(question_image_path))[1] <> 'questions'
    or (storage.foldername(question_image_path))[2] <> auth.uid()::text
  ) then raise exception 'INVALID_ATTACHMENT_PATH'; end if;
  insert into public.questions (author_id, text, image_path)
  values (auth.uid(), trim(question_text), question_image_path)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.create_question(text, text) from public;
grant execute on function public.create_question(text, text) to authenticated;

drop policy if exists "anyone reads answers" on public.answers;
drop policy if exists "signed in users answer" on public.answers;
drop policy if exists "authors update answers" on public.answers;
create policy "users read allowed answers" on public.answers for select using (public.can_read_question(question_id));
-- Pas de policy INSERT/UPDATE : une réponse doit passer par submit_answer().

drop policy if exists "signed in users report" on public.reports;
create policy "signed in users report" on public.reports for insert with check (auth.uid() = reporter_id);

create or replace function public.claim_question(question_uuid uuid)
returns public.questions
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.questions;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  update public.questions
  set claimed_by = auth.uid(), claimed_until = now() + interval '1 minute'
  where id = question_uuid
    and status = 'open'
    and (claimed_until is null or claimed_until < now())
  returning * into result;
  if result.id is null then raise exception 'QUESTION_UNAVAILABLE'; end if;
  return result;
end;
$$;

create or replace function public.submit_answer(question_uuid uuid, answer_text text, answer_image_path text default null)
returns public.answers
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.answers;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(trim(coalesce(answer_text, ''))) = 0 and answer_image_path is null then raise exception 'ANSWER_EMPTY'; end if;
  if answer_image_path is not null and (
    (storage.foldername(answer_image_path))[1] <> 'answers'
    or (storage.foldername(answer_image_path))[2] <> auth.uid()::text
  ) then raise exception 'INVALID_ATTACHMENT_PATH'; end if;

  insert into public.answers (question_id, author_id, text, image_path)
  select question_uuid, auth.uid(), coalesce(nullif(trim(answer_text), ''), 'Réponse en image'), answer_image_path
  from public.questions q
  where q.id = question_uuid
    and q.status = 'open'
    and q.claimed_by = auth.uid()
    and q.claimed_until is not null
    and q.claimed_until > now()
  returning * into result;

  if result.id is null then raise exception 'QUESTION_NOT_RESERVED'; end if;
  update public.questions
  set status = 'answered', claimed_by = null, claimed_until = null
  where id = question_uuid and claimed_by = auth.uid();
  return result;
end;
$$;

create or replace function public.release_expired_claims()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.questions set claimed_by = null, claimed_until = null
  where status = 'open' and claimed_until is not null and claimed_until < now();
$$;

revoke all on function public.claim_question(uuid) from public;
revoke all on function public.create_question(text, text) from public;
revoke all on function public.submit_answer(uuid, text, text) from public;
revoke all on function public.release_expired_claims() from public;
grant execute on function public.claim_question(uuid) to authenticated;
grant execute on function public.submit_answer(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel r on r.prpubid = p.oid
    where p.pubname = 'supabase_realtime' and r.prrelid = 'public.questions'::regclass
  ) then
    alter publication supabase_realtime add table public.questions;
  end if;
  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel r on r.prpubid = p.oid
    where p.pubname = 'supabase_realtime' and r.prrelid = 'public.answers'::regclass
  ) then
    alter publication supabase_realtime add table public.answers;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated users upload images" on storage.objects;
drop policy if exists "anyone reads question images" on storage.objects;
drop policy if exists "authenticated users read images" on storage.objects;
drop policy if exists "users read allowed images" on storage.objects;
create policy "authenticated users upload images" on storage.objects for insert to authenticated with check (
  bucket_id = 'question-images'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (storage.foldername(name))[1] in ('questions', 'answers')
);
create policy "users read allowed images" on storage.objects for select using (
  bucket_id = 'question-images'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or exists (select 1 from public.questions q where q.image_path = name and public.can_read_question(q.id))
    or exists (select 1 from public.answers a where a.image_path = name and public.can_read_question(a.question_id))
  )
);
