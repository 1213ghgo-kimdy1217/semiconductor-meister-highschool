-- Run as the database administrator after applying the migration.
-- Every fixture, helper, and test write is rolled back. No password/key is read or printed.
-- SQL role simulation complements (does not replace) actual Auth/REST/Storage API testing.
begin;

create temporary table rls_fixture (name text primary key, id uuid not null);
insert into rls_fixture(name, id) values
  ('a', gen_random_uuid()), ('b', gen_random_uuid()),
  ('pc_a', gen_random_uuid()), ('pc_a2', gen_random_uuid()), ('pc_b', gen_random_uuid()),
  ('inspection_a', gen_random_uuid()), ('inspection_b', gen_random_uuid());
create temporary table rls_results (label text primary key, passed boolean not null);
do $$ begin
  execute format('grant usage on schema %I to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant select on rls_fixture to authenticated, anon;
grant insert, select on rls_results to authenticated, anon;

create function pg_temp.fixture(p_name text) returns uuid language sql stable security invoker
  set search_path = pg_temp as $$ select id from pg_temp.rls_fixture where name = p_name $$;
create function pg_temp.assert_true(p_label text, p_ok boolean) returns void language plpgsql security invoker
  set search_path = pg_temp as $$
begin
  if p_ok is distinct from true then raise exception 'RLS assertion failed: %', p_label; end if;
  insert into pg_temp.rls_results values (p_label, true);
end $$;
create function pg_temp.assert_rows(p_label text, p_sql text, p_expected bigint) returns void language plpgsql security invoker
  set search_path = pg_temp as $$
declare changed bigint;
begin
  execute p_sql;
  get diagnostics changed = row_count;
  perform pg_temp.assert_true(p_label, changed = p_expected);
end $$;
create function pg_temp.assert_denied(p_label text, p_sql text, p_state text default '42501') returns void language plpgsql security invoker
  set search_path = pg_temp as $$
declare denied boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise; end if;
    denied := true;
  end;
  perform pg_temp.assert_true(p_label, denied);
end $$;
create function pg_temp.settings_snapshots_stay_newer() returns boolean language plpgsql security invoker
  set search_path = pg_temp as $$
declare
  newer_at timestamptz := now() + interval '1 second';
  latest_at timestamptz := now() + interval '2 seconds';
  previous_server_at timestamptz;
  stale_blocked boolean;
begin
  update public.settings set calibration_version=10, local_updated_at=newer_at
    where owner_id=pg_temp.fixture('a') and device_id=pg_temp.fixture('pc_a') and camera_id='real'
    returning updated_at into previous_server_at;
  update public.settings set calibration_version=999, local_updated_at=now()-interval '1 second', updated_at='2000-01-01'
    where owner_id=pg_temp.fixture('a') and device_id=pg_temp.fixture('pc_a') and camera_id='real';
  select calibration_version=10 and local_updated_at=newer_at and updated_at=previous_server_at into stale_blocked
    from public.settings where owner_id=pg_temp.fixture('a') and device_id=pg_temp.fixture('pc_a') and camera_id='real';
  update public.settings set calibration_version=11, local_updated_at=latest_at, updated_at='2000-01-01'
    where owner_id=pg_temp.fixture('a') and device_id=pg_temp.fixture('pc_a') and camera_id='real';
  return stale_blocked and (select calibration_version=11 and local_updated_at=latest_at and updated_at>=previous_server_at
    from public.settings where owner_id=pg_temp.fixture('a') and device_id=pg_temp.fixture('pc_a') and camera_id='real');
end $$;
create function pg_temp.inspection_snapshots_stay_newer() returns boolean language plpgsql security invoker
  set search_path = pg_temp as $$
declare
  newer_at timestamptz := now() + interval '1 second';
  latest_at timestamptz := now() + interval '2 seconds';
  stale_blocked boolean;
begin
  update public.inspections set plc_detail='newer', local_updated_at=newer_at where id=pg_temp.fixture('inspection_a');
  update public.inspections set plc_detail='stale', local_updated_at=now()-interval '1 second' where id=pg_temp.fixture('inspection_a');
  select plc_detail='newer' and local_updated_at=newer_at into stale_blocked
    from public.inspections where id=pg_temp.fixture('inspection_a');
  update public.inspections set plc_detail='latest', local_updated_at=latest_at where id=pg_temp.fixture('inspection_a');
  return stale_blocked and (select plc_detail='latest' and local_updated_at=latest_at
    from public.inspections where id=pg_temp.fixture('inspection_a'));
end $$;
grant execute on function pg_temp.fixture(text), pg_temp.assert_true(text, boolean),
  pg_temp.assert_rows(text, text, bigint), pg_temp.assert_denied(text, text, text),
  pg_temp.settings_snapshots_stay_newer(), pg_temp.inspection_snapshots_stay_newer() to authenticated, anon;

insert into auth.users(id, aud, role, email, email_confirmed_at, created_at, updated_at, is_anonymous)
select id, 'authenticated', 'authenticated', 'rls-' || id::text || '@example.invalid', now(), now(), now(), false
from pg_temp.rls_fixture where name in ('a', 'b');

insert into public.settings(owner_id, device_id, camera_id, roi, calibration_version, thresholds, local_updated_at)
values
  (pg_temp.fixture('a'), pg_temp.fixture('pc_a'), 'real', '{}', 1, '{}', now()),
  (pg_temp.fixture('a'), pg_temp.fixture('pc_a2'), 'real', '{}', 1, '{}', now()),
  (pg_temp.fixture('b'), pg_temp.fixture('pc_b'), 'real', '{}', 1, '{}', now());

insert into public.inspections(id, owner_id, device_id, device_session, cycle_id, capture_id,
  mode, verdict, method, version, calibration_version, requested_at, camera, plc_result_state, local_updated_at)
values
  (pg_temp.fixture('inspection_a'), pg_temp.fixture('a'), pg_temp.fixture('pc_a'), 1, 1, 1,
    'sim', 'OK', 'ref-compare', 'cmp1.0', 1, now(), 'virtual', 'valid', now()),
  (pg_temp.fixture('inspection_b'), pg_temp.fixture('b'), pg_temp.fixture('pc_b'), 1, 1, 1,
    'sim', 'NG', 'ref-compare', 'cmp1.0', 1, now(), 'virtual', 'valid', now());
insert into public.events(owner_id, device_id, local_event_id, inspection_id, event_type, created_at)
values
  (pg_temp.fixture('a'), pg_temp.fixture('pc_a'), 1, pg_temp.fixture('inspection_a'), 'test', now()),
  (pg_temp.fixture('b'), pg_temp.fixture('pc_b'), 1, pg_temp.fixture('inspection_b'), 'test', now());
insert into storage.objects(bucket_id, name, owner_id)
values
  ('inspection-images', pg_temp.fixture('a')::text || '/inspections/' || pg_temp.fixture('inspection_a')::text || '.png', pg_temp.fixture('a')::text),
  ('inspection-images', pg_temp.fixture('b')::text || '/inspections/' || pg_temp.fixture('inspection_b')::text || '.png', pg_temp.fixture('b')::text);

select pg_temp.assert_true('all three tables enable RLS',
  (select count(*) = 3 from pg_class where oid in ('public.settings'::regclass, 'public.inspections'::regclass, 'public.events'::regclass) and relrowsecurity));
select pg_temp.assert_true('image bucket is private',
  (select public = false from storage.buckets where id = 'inspection-images'));
select pg_temp.assert_true('image bucket has MIME and size restrictions',
  (select file_size_limit = 2097152 and allowed_mime_types = array['image/png', 'image/jpeg'] from storage.buckets where id = 'inspection-images'));
select pg_temp.assert_true('image bucket has no permissive DELETE policy',
  not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and permissive='PERMISSIVE' and cmd in ('DELETE','ALL')));

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fixture('a'), 'role', 'authenticated', 'is_anonymous', false)::text, true);

select pg_temp.assert_true('A sees both of its PC settings', (select count(*) = 2 from public.settings));
select pg_temp.assert_true('A cannot select B settings', not exists(select 1 from public.settings where owner_id = pg_temp.fixture('b')));
select pg_temp.assert_rows('A updates own settings', $$update public.settings set calibration_version = 2 where owner_id = pg_temp.fixture('a') and device_id = pg_temp.fixture('pc_a')$$, 1);
select pg_temp.assert_rows('A cannot update B settings', $$update public.settings set calibration_version = 99 where owner_id = pg_temp.fixture('b')$$, 0);
select pg_temp.assert_denied('A cannot insert B settings', $$insert into public.settings(owner_id,device_id,camera_id,roi,calibration_version,thresholds,local_updated_at) values(pg_temp.fixture('b'),pg_temp.fixture('pc_a'),'virtual','{}',0,'{}',now())$$);
select pg_temp.assert_denied('A cannot transfer settings ownership', $$update public.settings set owner_id=pg_temp.fixture('b') where owner_id=pg_temp.fixture('a') and device_id=pg_temp.fixture('pc_a')$$);
select pg_temp.assert_denied('A cannot delete own settings', $$delete from public.settings where owner_id=pg_temp.fixture('a')$$);
select pg_temp.assert_rows('A inserts own settings', $$insert into public.settings(owner_id,device_id,camera_id,roi,calibration_version,thresholds,local_updated_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),'virtual','{}',0,'{}',now())$$, 1);

select pg_temp.assert_true('A sees only its inspection', (select count(*) = 1 from public.inspections));
select pg_temp.assert_true('A cannot select B inspection', not exists(select 1 from public.inspections where id = pg_temp.fixture('inspection_b')));
select pg_temp.assert_rows('A updates own inspection', $$update public.inspections set plc_detail='sql-test' where id=pg_temp.fixture('inspection_a')$$, 1);
select pg_temp.assert_rows('A cannot update B inspection', $$update public.inspections set plc_detail='forbidden' where id=pg_temp.fixture('inspection_b')$$, 0);
select pg_temp.assert_denied('A cannot insert B inspection', $$insert into public.inspections(id,owner_id,device_id,mode,verdict,method,version,calibration_version,requested_at,camera,plc_result_state,local_updated_at) values(gen_random_uuid(),pg_temp.fixture('b'),pg_temp.fixture('pc_a'),'check','HOLD','ref-compare','cmp1.0',1,now(),'real','none',now())$$);
select pg_temp.assert_denied('A cannot transfer inspection ownership', $$update public.inspections set owner_id=pg_temp.fixture('b') where id=pg_temp.fixture('inspection_a')$$);
select pg_temp.assert_denied('A cannot delete own inspection', $$delete from public.inspections where id=pg_temp.fixture('inspection_a')$$);
select pg_temp.assert_rows('two PCs may reuse session cycle capture values', $$insert into public.inspections(id,owner_id,device_id,device_session,cycle_id,capture_id,mode,verdict,method,version,calibration_version,requested_at,camera,plc_result_state,local_updated_at) values(gen_random_uuid(),pg_temp.fixture('a'),pg_temp.fixture('pc_a2'),1,1,1,'sim','OK','ref-compare','cmp1.0',1,now(),'virtual','valid',now())$$, 1);
select pg_temp.assert_denied('same PC duplicate capture is rejected', $$insert into public.inspections(id,owner_id,device_id,device_session,cycle_id,capture_id,mode,verdict,method,version,calibration_version,requested_at,camera,plc_result_state,local_updated_at) values(gen_random_uuid(),pg_temp.fixture('a'),pg_temp.fixture('pc_a'),1,1,1,'sim','OK','ref-compare','cmp1.0',1,now(),'virtual','valid',now())$$, '23505');
select pg_temp.assert_denied('foreign image path is rejected', $$update public.inspections set image_path=pg_temp.fixture('b')::text||'/inspections/'||id::text||'.png' where id=pg_temp.fixture('inspection_a')$$, '23514');
select pg_temp.assert_denied('web cannot claim physical collection', $$update public.inspections set collection_confirmed=true where id=pg_temp.fixture('inspection_a')$$, '23514');
select pg_temp.assert_true('stale settings do not overwrite newer snapshots; server updated_at is monotonic', pg_temp.settings_snapshots_stay_newer());
select pg_temp.assert_true('stale inspections do not overwrite newer snapshots; later own updates still work', pg_temp.inspection_snapshots_stay_newer());

select pg_temp.assert_true('A sees only its event', (select count(*) = 1 from public.events));
select pg_temp.assert_true('A cannot select B event', not exists(select 1 from public.events where owner_id = pg_temp.fixture('b')));
select pg_temp.assert_rows('A updates own event', $$update public.events set event_type='sql-test' where owner_id=pg_temp.fixture('a')$$, 1);
select pg_temp.assert_rows('A cannot update B event', $$update public.events set event_type='forbidden' where owner_id=pg_temp.fixture('b')$$, 0);
select pg_temp.assert_denied('A cannot insert B event', $$insert into public.events(owner_id,device_id,local_event_id,event_type,created_at) values(pg_temp.fixture('b'),pg_temp.fixture('pc_a'),2,'forbidden',now())$$);
select pg_temp.assert_denied('A cannot transfer event ownership', $$update public.events set owner_id=pg_temp.fixture('b') where owner_id=pg_temp.fixture('a')$$);
select pg_temp.assert_denied('A cannot reference B inspection', $$insert into public.events(owner_id,device_id,local_event_id,inspection_id,event_type,created_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),2,pg_temp.fixture('inspection_b'),'forbidden',now())$$, '23503');
select pg_temp.assert_denied('A cannot delete own events', $$delete from public.events where owner_id=pg_temp.fixture('a')$$);
select pg_temp.assert_denied('event retry key prevents duplicates', $$insert into public.events(owner_id,device_id,local_event_id,event_type,created_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),1,'duplicate',now())$$, '23505');
select pg_temp.assert_rows('A inserts own standalone event', $$insert into public.events(owner_id,device_id,local_event_id,event_type,created_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),3,'own',now())$$, 1);

select pg_temp.assert_true('A sees only its image', (select count(*) = 1 from storage.objects where bucket_id='inspection-images'));
select pg_temp.assert_true('A cannot read B image', not exists(select 1 from storage.objects where bucket_id='inspection-images' and owner_id=pg_temp.fixture('b')::text));
select pg_temp.assert_rows('A updates own image metadata', $$update storage.objects set metadata='{"sql_test":true}'::jsonb where bucket_id='inspection-images' and owner_id=pg_temp.fixture('a')::text$$, 1);
select pg_temp.assert_rows('A cannot update B image', $$update storage.objects set metadata='{"forbidden":true}'::jsonb where bucket_id='inspection-images' and owner_id=pg_temp.fixture('b')::text$$, 0);
select pg_temp.assert_denied('A cannot upload into B folder', $$insert into storage.objects(bucket_id,name,owner_id) values('inspection-images',pg_temp.fixture('b')::text||'/refs/forbidden.png',pg_temp.fixture('a')::text)$$);
select pg_temp.assert_denied('A cannot spoof image owner', $$insert into storage.objects(bucket_id,name,owner_id) values('inspection-images',pg_temp.fixture('a')::text||'/refs/forbidden.png',pg_temp.fixture('b')::text)$$);
select pg_temp.assert_denied('A cannot move image into B folder', $$update storage.objects set name=pg_temp.fixture('b')::text||'/refs/moved.png' where bucket_id='inspection-images' and owner_id=pg_temp.fixture('a')::text$$);
select pg_temp.assert_rows('A inserts own image', $$insert into storage.objects(bucket_id,name,owner_id) values('inspection-images',pg_temp.fixture('a')::text||'/refs/own.png',pg_temp.fixture('a')::text)$$, 1);
-- Hosted Supabase also protects direct metadata deletion; exercise that guard without disabling it.
select pg_temp.assert_denied('A cannot delete image metadata directly', $$delete from storage.objects where bucket_id='inspection-images' and owner_id=pg_temp.fixture('a')::text$$);

-- B must be isolated in the opposite direction as well.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fixture('b'), 'role', 'authenticated', 'is_anonymous', false)::text, true);
select pg_temp.assert_true('B sees only its settings', (select count(*)=1 from public.settings));
select pg_temp.assert_true('B sees only its inspection', (select count(*)=1 from public.inspections));
select pg_temp.assert_true('B sees only its event', (select count(*)=1 from public.events));
select pg_temp.assert_true('B sees only its image', (select count(*)=1 from storage.objects where bucket_id='inspection-images'));
select pg_temp.assert_rows('B cannot update A settings', $$update public.settings set calibration_version=99 where owner_id=pg_temp.fixture('a')$$, 0);
select pg_temp.assert_rows('B cannot update A inspection', $$update public.inspections set plc_detail='forbidden' where owner_id=pg_temp.fixture('a')$$, 0);
select pg_temp.assert_rows('B cannot update A event', $$update public.events set event_type='forbidden' where owner_id=pg_temp.fixture('a')$$, 0);
select pg_temp.assert_rows('B cannot update A image', $$update storage.objects set metadata='{"forbidden":true}'::jsonb where bucket_id='inspection-images' and owner_id=pg_temp.fixture('a')::text$$, 0);

-- Anonymous Auth users have role authenticated, but must still be blocked.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fixture('a'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
select pg_temp.assert_true('anonymous Auth sees no settings', not exists(select 1 from public.settings));
select pg_temp.assert_true('anonymous Auth sees no inspections', not exists(select 1 from public.inspections));
select pg_temp.assert_true('anonymous Auth sees no events', not exists(select 1 from public.events));
select pg_temp.assert_true('anonymous Auth sees no images', not exists(select 1 from storage.objects where bucket_id='inspection-images'));
select pg_temp.assert_denied('anonymous Auth cannot insert settings', $$insert into public.settings(owner_id,device_id,camera_id,roi,calibration_version,thresholds,local_updated_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),'virtual','{}',0,'{}',now())$$);
select pg_temp.assert_denied('anonymous Auth cannot insert inspection', $$insert into public.inspections(id,owner_id,device_id,mode,verdict,method,version,calibration_version,requested_at,camera,plc_result_state,local_updated_at) values(gen_random_uuid(),pg_temp.fixture('a'),pg_temp.fixture('pc_a'),'check','HOLD','ref-compare','cmp1.0',1,now(),'real','none',now())$$);
select pg_temp.assert_denied('anonymous Auth cannot insert events', $$insert into public.events(owner_id,device_id,local_event_id,event_type,created_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),99,'forbidden',now())$$);
select pg_temp.assert_denied('anonymous Auth cannot upload', $$insert into storage.objects(bucket_id,name,owner_id) values('inspection-images',pg_temp.fixture('a')::text||'/refs/anonymous.png',pg_temp.fixture('a')::text)$$);

-- No session: tables have no anon privilege; storage has no matching policy.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.assert_denied('anon cannot select settings', $$select * from public.settings$$);
select pg_temp.assert_denied('anon cannot select inspections', $$select * from public.inspections$$);
select pg_temp.assert_denied('anon cannot select events', $$select * from public.events$$);
select pg_temp.assert_denied('anon cannot insert settings', $$insert into public.settings(owner_id,device_id,camera_id,roi,calibration_version,thresholds,local_updated_at) values(pg_temp.fixture('a'),pg_temp.fixture('pc_a'),'virtual','{}',0,'{}',now())$$);
select pg_temp.assert_denied('anon cannot update inspections', $$update public.inspections set verdict='NG'$$);
select pg_temp.assert_denied('anon cannot delete events', $$delete from public.events$$);
select pg_temp.assert_true('anon cannot read images', not exists(select 1 from storage.objects where bucket_id='inspection-images'));
select pg_temp.assert_denied('anon cannot upload', $$insert into storage.objects(bucket_id,name,owner_id) values('inspection-images',pg_temp.fixture('a')::text||'/refs/anon.png',pg_temp.fixture('a')::text)$$);

reset role;
select count(*)::int as passed, count(*) filter(where not passed)::int as failed,
  jsonb_agg(label order by label) as assertions from pg_temp.rls_results;
rollback;
