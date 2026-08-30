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

create policy "profiles are public" on public.profiles for select using (true);
create policy "users create their profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update their profile" on public.profiles for update using (auth.uid() = id);

create policy "anyone reads visible questions" on public.questions for select using (status = 'open' or author_id = auth.uid());
create policy "signed in users ask" on public.questions for insert with check (auth.uid() = author_id);
create policy "authors update questions" on public.questions for update using (auth.uid() = author_id or auth.uid() = claimed_by);

create policy "anyone reads answers" on public.answers for select using (true);
create policy "signed in users answer" on public.answers for insert with check (auth.uid() = author_id);
create policy "authors update answers" on public.answers for update using (auth.uid() = author_id);

create policy "signed in users report" on public.reports for insert with check (auth.uid() = reporter_id);

create or replace function public.claim_question(question_uuid uuid)
returns public.questions
language plpgsql
security invoker
as $$
declare result public.questions;
begin
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

create or replace function public.release_expired_claims()
returns void language sql security definer as $$
  update public.questions set claimed_by = null, claimed_until = null
  where status = 'open' and claimed_until is not null and claimed_until < now();
$$;

alter publication supabase_realtime add table public.questions;
alter publication supabase_realtime add table public.answers;

insert into storage.buckets (id, name, public) values ('question-images', 'question-images', true) on conflict (id) do nothing;
create policy "authenticated users upload images" on storage.objects for insert to authenticated with check (bucket_id = 'question-images');
create policy "anyone reads question images" on storage.objects for select using (bucket_id = 'question-images');
