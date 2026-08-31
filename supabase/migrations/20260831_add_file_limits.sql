-- Compte les fichiers uploadés par un utilisateur aujourd'hui (quota 2/jour)
create or replace function public.count_daily_files(uid uuid)
returns integer
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select count(*)::integer
  from public.file_uploads
  where uploader_id = uid
    and created_at >= date_trunc('day', now());
$$;
revoke all on function public.count_daily_files(uuid) from public;
grant execute on function public.count_daily_files(uuid) to authenticated;

-- Supprime les fichiers de plus de 24h du stockage et de file_uploads (appelé par cron)
create or replace function public.cleanup_expired_files()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  deleted_count integer := 0;
  expired record;
begin
  for expired in
    select path from public.file_uploads
    where created_at < now() - interval '1 day'
  loop
    begin
      delete from storage.objects
      where bucket_id = 'question-images' and name = expired.path;
    exception when others then null;
    end;
  end loop;
  delete from public.file_uploads where created_at < now() - interval '1 day';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.cleanup_expired_files() from public;
grant execute on function public.cleanup_expired_files() to service_role;

-- Mettre à jour la limite de taille du bucket à 30 Mo
update storage.buckets set file_size_limit = 31457280 where id = 'question-images';
