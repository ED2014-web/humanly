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

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 4000),
  image_path text,
  created_at timestamptz not null default now()
);

alter table public.questions add column if not exists file_path text;
alter table public.questions add column if not exists file_name text;
alter table public.questions add column if not exists file_type text;
alter table public.questions add column if not exists file_size bigint;
alter table public.answers add column if not exists file_path text;
alter table public.answers add column if not exists file_name text;
alter table public.answers add column if not exists file_type text;
alter table public.answers add column if not exists file_size bigint;
alter table public.messages add column if not exists file_path text;
alter table public.messages add column if not exists file_name text;
alter table public.messages add column if not exists file_type text;
alter table public.messages add column if not exists file_size bigint;

create table if not exists public.file_uploads (
  path text primary key,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 180),
  file_type text not null,
  file_size bigint not null check (file_size between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null check (scan_status in ('clean', 'infected', 'failed')),
  scanner text not null,
  created_at timestamptz not null default now()
);

alter table public.file_uploads enable row level security;

drop policy if exists "users read own clean uploads" on public.file_uploads;
create policy "users read own clean uploads" on public.file_uploads for select using (auth.uid() = uploader_id and scan_status = 'clean');

create or replace function public.is_clean_upload(upload_path text, expected_folder text, expected_user uuid, expected_name text, expected_type text, expected_size bigint)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.file_uploads f
    where f.path = upload_path
      and f.uploader_id = expected_user
      and f.scan_status = 'clean'
      and (storage.foldername(f.path))[1] = expected_folder
      and (storage.foldername(f.path))[2] = expected_user::text
      and f.file_name = expected_name
      and f.file_type = expected_type
      and f.file_size = expected_size
  );
$$;
revoke all on function public.is_clean_upload(text, text, uuid, text, text, bigint) from public;
grant execute on function public.is_clean_upload(text, text, uuid, text, text, bigint) to authenticated;

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
alter table public.messages enable row level security;
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
        or exists (select 1 from public.messages m where m.question_id = q.id and m.author_id = auth.uid())
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
drop policy if exists "authors delete questions" on public.questions;
create policy "anyone reads visible questions" on public.questions for select using (public.can_read_question(id));
create policy "authors delete questions" on public.questions for delete using (auth.uid() = author_id);
-- La création passe exclusivement par create_question, après upload validé et analysé.
-- L’absence de policy INSERT empêche tout contournement direct du contrôle serveur.
-- Les questions ne sont plus modifiables directement par le navigateur. Les changements sensibles passent par une fonction contrôlée.
drop function if exists public.create_question(text, text);
create or replace function public.create_question(question_text text, question_file_path text default null, question_file_name text default null, question_file_type text default null, question_file_size bigint default null)
returns public.questions
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.questions;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(trim(coalesce(question_text, ''))) < 3 or char_length(trim(question_text)) > 2000 then raise exception 'QUESTION_INVALID'; end if;
  if question_file_size is not null and (question_file_size < 0 or question_file_size > 20971520) then raise exception 'FILE_TOO_LARGE'; end if;
  if question_file_path is not null and not public.is_clean_upload(question_file_path, 'questions', auth.uid(), question_file_name, question_file_type, question_file_size) then raise exception 'ATTACHMENT_NOT_SCANNED'; end if;
  insert into public.questions (author_id, text, file_path, file_name, file_type, file_size)
  values (auth.uid(), trim(question_text), question_file_path, nullif(trim(question_file_name), ''), nullif(trim(question_file_type), ''), question_file_size)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.create_question(text, text, text, text, bigint) from public;
grant execute on function public.create_question(text, text, text, text, bigint) to authenticated;

drop policy if exists "anyone reads answers" on public.answers;
drop policy if exists "users read allowed answers" on public.answers;
drop policy if exists "signed in users answer" on public.answers;
drop policy if exists "authors update answers" on public.answers;
create policy "users read allowed answers" on public.answers for select using (public.can_read_question(question_id));
drop policy if exists "users read allowed messages" on public.messages;
create policy "users read allowed messages" on public.messages for select using (public.can_read_question(question_id));
-- Pas de policy INSERT/UPDATE : les réponses et messages passent par des fonctions contrôlées.

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

drop function if exists public.submit_answer(uuid, text, text);
create or replace function public.submit_answer(question_uuid uuid, answer_text text, answer_file_path text default null, answer_file_name text default null, answer_file_type text default null, answer_file_size bigint default null)
returns public.answers
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.answers;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(trim(coalesce(answer_text, ''))) = 0 and answer_file_path is null then raise exception 'ANSWER_EMPTY'; end if;
  if answer_file_size is not null and (answer_file_size < 0 or answer_file_size > 20971520) then raise exception 'FILE_TOO_LARGE'; end if;
  if answer_file_path is not null and not public.is_clean_upload(answer_file_path, 'answers', auth.uid(), answer_file_name, answer_file_type, answer_file_size) then raise exception 'ATTACHMENT_NOT_SCANNED'; end if;
  insert into public.answers (question_id, author_id, text, file_path, file_name, file_type, file_size)
  select question_uuid, auth.uid(), coalesce(nullif(trim(answer_text), ''), 'Réponse avec fichier'), answer_file_path, nullif(trim(answer_file_name), ''), nullif(trim(answer_file_type), ''), answer_file_size
  from public.questions q
  where q.id = question_uuid and q.status = 'open' and q.claimed_by = auth.uid() and q.claimed_until is not null and q.claimed_until > now()
  returning * into result;
  if result.id is null then raise exception 'QUESTION_NOT_RESERVED'; end if;
  update public.questions set status = 'answered', claimed_by = null, claimed_until = null where id = question_uuid and claimed_by = auth.uid();
  return result;
end;
$$;

drop function if exists public.submit_message(uuid, text, text);
create or replace function public.submit_message(question_uuid uuid, message_text text, message_file_path text default null, message_file_name text default null, message_file_type text default null, message_file_size bigint default null)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.messages;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(trim(coalesce(message_text, ''))) = 0 and message_file_path is null then raise exception 'MESSAGE_EMPTY'; end if;
  if char_length(trim(coalesce(message_text, ''))) > 4000 then raise exception 'MESSAGE_INVALID'; end if;
  if message_file_size is not null and (message_file_size < 0 or message_file_size > 20971520) then raise exception 'FILE_TOO_LARGE'; end if;
  if message_file_path is not null and not public.is_clean_upload(message_file_path, 'messages', auth.uid(), message_file_name, message_file_type, message_file_size) then raise exception 'ATTACHMENT_NOT_SCANNED'; end if;
  insert into public.messages (question_id, author_id, text, file_path, file_name, file_type, file_size)
  select question_uuid, auth.uid(), coalesce(nullif(trim(message_text), ''), 'Message avec fichier'), message_file_path, nullif(trim(message_file_name), ''), nullif(trim(message_file_type), ''), message_file_size
  from public.questions q
  where q.id = question_uuid and (q.author_id = auth.uid() or q.claimed_by = auth.uid() or exists (select 1 from public.answers a where a.question_id = q.id and a.author_id = auth.uid()) or exists (select 1 from public.messages m where m.question_id = q.id and m.author_id = auth.uid()))
  returning * into result;
  if result.id is null then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  return result;
end;
$$;

create or replace function public.refresh_claim(question_uuid uuid)
returns public.questions
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.questions;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  update public.questions set claimed_until = now() + interval '1 minute' where id = question_uuid and status = 'open' and claimed_by = auth.uid() returning * into result;
  if result.id is null then raise exception 'QUESTION_NOT_RESERVED'; end if;
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

create or replace function public.delete_question(question_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists (select 1 from public.questions where id = question_uuid and author_id = auth.uid()) then
    raise exception 'QUESTION_DELETE_FORBIDDEN';
  end if;

  -- Le nettoyage du stockage est best-effort : une erreur de stockage ne doit
  -- jamais empêcher la suppression définitive des données de conversation.
  begin
    delete from storage.objects
    where bucket_id = 'question-images'
      and name in (
        select image_path from public.questions where id = question_uuid and image_path is not null
        union all select file_path from public.questions where id = question_uuid and file_path is not null
        union all select image_path from public.answers where question_id = question_uuid and image_path is not null
        union all select file_path from public.answers where question_id = question_uuid and file_path is not null
        union all select image_path from public.messages where question_id = question_uuid and image_path is not null
        union all select file_path from public.messages where question_id = question_uuid and file_path is not null
      );
  exception when others then
    null;
  end;

  delete from public.file_uploads
  where path in (
    select image_path from public.questions where id = question_uuid and image_path is not null
    union all select file_path from public.questions where id = question_uuid and file_path is not null
    union all select image_path from public.answers where question_id = question_uuid and image_path is not null
    union all select file_path from public.answers where question_id = question_uuid and file_path is not null
    union all select image_path from public.messages where question_id = question_uuid and image_path is not null
    union all select file_path from public.messages where question_id = question_uuid and file_path is not null
  );

  delete from public.questions where id = question_uuid and author_id = auth.uid();
end;
$$;

revoke all on function public.claim_question(uuid) from public;
revoke all on function public.create_question(text, text) from public;
revoke all on function public.submit_answer(uuid, text, text, text, text, bigint) from public;
revoke all on function public.submit_message(uuid, text, text, text, text, bigint) from public;
revoke all on function public.refresh_claim(uuid) from public;
revoke all on function public.release_expired_claims() from public;
revoke all on function public.delete_question(uuid) from public;
grant execute on function public.claim_question(uuid) to authenticated;
grant execute on function public.submit_answer(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.submit_message(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.refresh_claim(uuid) to authenticated;
grant execute on function public.delete_question(uuid) to authenticated;

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
  if not exists (
    select 1 from pg_publication p
    join pg_publication_rel r on r.prpubid = p.oid
    where p.pubname = 'supabase_realtime' and r.prrelid = 'public.messages'::regclass
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', false, 20971520, null)
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = null;

drop policy if exists "authenticated users upload images" on storage.objects;
drop policy if exists "authenticated users upload files" on storage.objects;
drop policy if exists "anyone reads question images" on storage.objects;
drop policy if exists "authenticated users read images" on storage.objects;
drop policy if exists "users read allowed images" on storage.objects;
-- Les uploads passent exclusivement par /api/files/upload, qui valide le nom,
-- l’extension, la signature MIME et l’antivirus avant d’utiliser la clé service.
-- Aucune policy INSERT n’est volontairement créée pour le navigateur.
create policy "users read allowed images" on storage.objects for select using (
  bucket_id = 'question-images'
  and (
    ((storage.foldername(name))[2] = auth.uid()::text
      and exists (select 1 from public.file_uploads f where f.path = name and f.scan_status = 'clean'))
    or exists (select 1 from public.questions q where (q.image_path = name or q.file_path = name) and public.can_read_question(q.id))
    or exists (select 1 from public.answers a where (a.image_path = name or a.file_path = name) and public.can_read_question(a.question_id))
    or exists (select 1 from public.messages m where (m.image_path = name or m.file_path = name) and public.can_read_question(m.question_id))
  )
);
