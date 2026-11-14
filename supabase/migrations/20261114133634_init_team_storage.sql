-- Team records only. This database is never a PLC/Uno command channel.
-- References remain scoped to the PC (device_id); other PCs must not load them automatically.

create table public.settings (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  camera_id text not null check (camera_id in ('real', 'virtual')),
  roi jsonb not null check (jsonb_typeof(roi) = 'object'),
  calibration_version integer not null check (calibration_version >= 0),
  thresholds jsonb not null check (jsonb_typeof(thresholds) = 'object'),
  refs jsonb not null default '{}'::jsonb check (jsonb_typeof(refs) = 'object'),
  local_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, device_id, camera_id)
);

create table public.inspections (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_session bigint check (device_session between 1 and 4294967295),
  cycle_id bigint check (cycle_id between 0 and 4294967295),
  capture_id bigint check (capture_id between 1 and 4294967295),
  mode text not null check (mode in ('live', 'sim', 'check')),
  verdict text not null check (verdict in ('OK', 'NG', 'HOLD')),
  hold_reason text,
  method text not null,
  version text not null,
  calibration_version integer not null check (calibration_version >= 0),
  scores jsonb,
  capture_time timestamptz,
  decision_time timestamptz,
  requested_at timestamptz not null,
  image_path text,
  plc_result_state text not null check (plc_result_state in
    ('none', 'withheld', 'sending', 'accepted', 'valid', 'rejected', 'no_ack', 'capture_failed', 'closed')),
  plc_detail text,
  route text check (route in ('OK', 'NG')),
  released boolean not null default false,
  collection_confirmed boolean not null default false,
  fault_code text,
  closed_why text,
  expected text check (expected in ('ok', 'ng', 'empty', 'occluded', 'other')),
  camera text not null check (camera in ('real', 'virtual')),
  camera_label text,
  attempts integer not null default 0 check (attempts >= 0),
  trail jsonb not null default '[]'::jsonb check (jsonb_typeof(trail) = 'array'),
  frame_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(frame_ids) = 'array'),
  local_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, device_id, device_session, cycle_id, capture_id),
  constraint inspections_image_owner_path check (
    image_path is null or image_path = owner_id::text || '/inspections/' || id::text || '.png'
  ),
  -- No protocol message currently confirms physical collection to the website.
  constraint inspections_collection_unconfirmed check (collection_confirmed = false)
);
create index inspections_owner_created_idx on public.inspections(owner_id, created_at desc, id desc);

create table public.events (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  inspection_id uuid,
  device_id uuid not null,
  local_event_id bigint not null check (local_event_id > 0),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null,
  unique (owner_id, device_id, local_event_id),
  -- A caller may not attach its event to another account's inspection.
  foreign key (owner_id, inspection_id) references public.inspections(owner_id, id)
    on delete cascade
);
create index events_owner_created_idx on public.events(owner_id, created_at desc);
create index events_inspection_idx on public.events(owner_id, inspection_id);

alter table public.settings enable row level security;
alter table public.inspections enable row level security;
alter table public.events enable row level security;

revoke all on public.settings, public.inspections, public.events from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update on public.settings, public.inspections, public.events to authenticated;
grant usage on sequence public.events_id_seq to authenticated;

-- Restrictive policies also exclude anonymous Auth sessions if Auth is later enabled accidentally.
create policy settings_permanent_accounts on public.settings as restrictive for all to authenticated
  using (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy settings_select_own on public.settings for select to authenticated
  using (owner_id = (select auth.uid()));
create policy settings_insert_own on public.settings for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy settings_update_own on public.settings for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy inspections_permanent_accounts on public.inspections as restrictive for all to authenticated
  using (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy inspections_select_own on public.inspections for select to authenticated
  using (owner_id = (select auth.uid()));
create policy inspections_insert_own on public.inspections for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy inspections_update_own on public.inspections for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy events_permanent_accounts on public.events as restrictive for all to authenticated
  using (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy events_select_own on public.events for select to authenticated
  using (owner_id = (select auth.uid()));
create policy events_insert_own on public.events for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy events_update_own on public.events for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-images', 'inspection-images', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage API sets owner_id from the authenticated JWT. Folder and object owner must both match.
create policy inspection_images_select_own on storage.objects for select to authenticated
  using (
    bucket_id = 'inspection-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
  );
create policy inspection_images_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inspection-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
  );
create policy inspection_images_update_own on storage.objects for update to authenticated
  using (
    bucket_id = 'inspection-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
  )
  with check (
    bucket_id = 'inspection-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)
  );

-- No DELETE grants/policies, Realtime subscriptions, command tables, or privileged RPCs.
