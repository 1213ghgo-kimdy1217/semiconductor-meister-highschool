-- A delayed upload from a disconnected tab must not roll a newer snapshot backwards.
-- No reads, privileged context, or device commands are involved in this trigger.
create function public.keep_newer_local_snapshot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.local_updated_at < old.local_updated_at then
    return old;
  end if;
  if tg_table_name = 'settings' then
    -- updated_at is server-maintained and cannot be moved backwards by a client.
    new.updated_at := greatest(old.updated_at, pg_catalog.clock_timestamp());
  end if;
  return new;
end;
$$;
revoke all on function public.keep_newer_local_snapshot() from public, anon, authenticated;

create trigger settings_keep_newer_snapshot
before update on public.settings for each row
execute function public.keep_newer_local_snapshot();

create trigger inspections_keep_newer_snapshot
before update on public.inspections for each row
execute function public.keep_newer_local_snapshot();
