-- Run in Supabase SQL Editor as the project database owner.
-- Safe to rerun on this schema: no tables/data are dropped. This is an initial
-- schema, not a general migration of unrelated tables with the same names.
begin;

do $$ begin create type public.emergency_type as enum ('flood','fire','medical','trapped','collapse','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.severity_level as enum ('Low','Medium','High','Critical'); exception when duplicate_object then null; end $$;
do $$ begin create type public.report_channel as enum ('text','voice','image'); exception when duplicate_object then null; end $$;
do $$ begin create type public.incident_status as enum ('open','resolved'); exception when duplicate_object then null; end $$;
do $$ begin create type public.unit_type as enum ('ambulance','fire_engine','rescue_boat','ndrf_team','general_rescue'); exception when duplicate_object then null; end $$;
do $$ begin create type public.unit_status as enum ('available','en_route','on_scene','returning'); exception when duplicate_object then null; end $$;
do $$ begin create type public.dispatch_status as enum ('en_route','on_scene','returning','completed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.location_source as enum ('gazetteer','nominatim','gps','unverified'); exception when duplicate_object then null; end $$;
do $$ begin create type public.vulnerable_group as enum ('children','elderly','pregnant','disabled'); exception when duplicate_object then null; end $$;

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  incident_number bigint generated always as identity unique,
  emergency_type public.emergency_type not null,
  status public.incident_status not null default 'open',
  severity public.severity_level not null,
  final_score integer not null check (final_score between 0 and 100),
  location_label text not null check (char_length(location_label) between 1 and 300),
  lat double precision,
  lng double precision,
  report_count integer not null default 0 check (report_count >= 0),
  cluster_reasoning jsonb not null default '{}'::jsonb check (jsonb_typeof(cluster_reasoning) = 'object'),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  last_report_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint incident_coordinates check (
    (lat is null and lng is null) or
    (lat is not null and lng is not null and lat between -90 and 90 and lng between -180 and 180)
  ),
  constraint incident_resolution check ((status = 'resolved') = (resolved_at is not null))
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  incident_id uuid not null references public.incidents(id) on delete restrict,
  channel public.report_channel not null,
  raw_text text not null default '' check (char_length(raw_text) <= 4000),
  image_description text check (char_length(image_description) <= 4000),
  image_data_url text check (
    image_data_url is null or (
      octet_length(image_data_url) <= 1500000
      and image_data_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    )
  ),
  location_label text not null check (char_length(location_label) between 1 and 300),
  location_source public.location_source not null,
  lat double precision,
  lng double precision,
  emergency_type public.emergency_type not null,
  people_count integer check (people_count between 0 and 10000),
  vulnerable_groups public.vulnerable_group[] not null default '{}',
  severity public.severity_level not null,
  final_score integer not null check (final_score between 0 and 100),
  entities jsonb not null check (jsonb_typeof(entities) = 'object'),
  reasoning jsonb not null check (jsonb_typeof(reasoning) = 'object'),
  cluster_outcome text not null check (cluster_outcome in ('new','merged')),
  match_distance_m double precision,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint report_has_content check (char_length(btrim(raw_text)) > 0 or image_data_url is not null),
  constraint report_image_channel check (channel <> 'image' or image_data_url is not null),
  constraint report_coordinates check (
    (location_source = 'unverified' and lat is null and lng is null) or
    (location_source <> 'unverified' and lat is not null and lng is not null
      and lat between -90 and 90 and lng between -180 and 180)
  ),
  constraint report_cluster_distance check (
    (cluster_outcome = 'new' and match_distance_m is null) or
    (cluster_outcome = 'merged' and match_distance_m is not null and match_distance_m between 0 and 300)
  )
);

create table if not exists public.units (
  id text primary key check (id ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  name text not null,
  unit_type public.unit_type not null,
  status public.unit_status not null default 'available',
  station_name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  station_lat double precision not null check (station_lat between -90 and 90),
  station_lng double precision not null check (station_lng between -180 and 180),
  current_incident_id uuid references public.incidents(id) on delete restrict,
  last_moved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false,
  constraint unit_assignment check ((status = 'available') = (current_incident_id is null))
);

create table if not exists public.dispatches (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete restrict,
  unit_id text not null references public.units(id) on delete restrict,
  status public.dispatch_status not null default 'en_route',
  distance_m double precision not null check (distance_m between 0 and 40040000),
  eta_seconds integer not null check (eta_seconds >= 0),
  reasoning text not null,
  is_auto boolean not null default false,
  is_demo boolean not null default false,
  dispatched_at timestamptz not null default now(),
  arrived_at timestamptz,
  returning_at timestamptz,
  completed_at timestamptz,
  constraint dispatch_completion check ((status = 'completed') = (completed_at is not null))
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  action text not null check (char_length(action) between 1 and 100),
  actor text not null check (actor in ('citizen','dispatcher','system','simulation')),
  incident_id uuid references public.incidents(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  unit_id text references public.units(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists incidents_open_match_idx on public.incidents (is_demo, emergency_type, last_report_at desc) where status = 'open';
create index if not exists incidents_triage_idx on public.incidents (severity desc, report_count desc, created_at) where status = 'open';
create index if not exists reports_incident_time_idx on public.reports (incident_id, created_at);
create index if not exists units_available_type_idx on public.units (is_demo, unit_type) where status = 'available';
create index if not exists units_incident_idx on public.units (current_incident_id);
create index if not exists dispatches_incident_time_idx on public.dispatches (incident_id, dispatched_at desc);
create index if not exists dispatches_unit_idx on public.dispatches (unit_id);
create index if not exists audit_created_idx on public.audit_log (created_at desc);
create index if not exists audit_incident_idx on public.audit_log (incident_id);
create index if not exists audit_report_idx on public.audit_log (report_id);
create index if not exists audit_unit_idx on public.audit_log (unit_id);
-- A second guard behind locking: a unit has only one unfinished assignment.
create unique index if not exists dispatches_one_active_unit on public.dispatches (unit_id) where status <> 'completed';
create unique index if not exists dispatches_one_active_incident on public.dispatches (incident_id) where status in ('en_route','on_scene');

alter table public.incidents enable row level security;
alter table public.reports enable row level security;
alter table public.units enable row level security;
alter table public.dispatches enable row level security;
alter table public.audit_log enable row level security;
-- No public policies. The service_role bypasses RLS and is confined to /api.
revoke all on public.incidents, public.reports, public.units, public.dispatches, public.audit_log from public, anon, authenticated;
grant select, insert, update, delete on public.incidents, public.reports, public.units, public.dispatches to service_role;
grant select, insert on public.audit_log to service_role;
grant usage on schema public to service_role;
revoke all on sequence public.incidents_incident_number_seq, public.audit_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.incidents_incident_number_seq, public.audit_log_id_seq to service_role;

-- Pure SQL versions of the shared TypeScript algorithms. These run inside the
-- same transaction as writes; tests compare both implementations for parity.
create or replace function public.dm_haversine_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable strict set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(least(1.0, greatest(0.0,
    power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)
  ))));
$$;

create or replace function public.dm_severity(score integer)
returns public.severity_level language sql immutable strict set search_path = '' as $$
  select (case when score >= 75 then 'Critical' when score >= 50 then 'High' when score >= 25 then 'Medium' else 'Low' end)::public.severity_level;
$$;

create or replace function public.dm_severity_rank(severity public.severity_level)
returns integer language sql immutable strict set search_path = '' as $$
  select case severity when 'Critical' then 3 when 'High' then 2 when 'Medium' then 1 else 0 end;
$$;

create or replace function public.dm_types_compatible(a public.emergency_type, b public.emergency_type)
returns boolean language sql immutable strict set search_path = '' as $$
  select a = b or (a in ('flood','trapped') and b in ('flood','trapped'));
$$;

create or replace function public.dm_unit_compatible(emergency public.emergency_type, kind public.unit_type)
returns boolean language sql immutable strict set search_path = '' as $$
  select case emergency
    when 'medical' then kind = 'ambulance'
    when 'fire' then kind = 'fire_engine'
    when 'flood' then kind in ('rescue_boat','ndrf_team')
    when 'trapped' then kind in ('rescue_boat','ndrf_team')
    else kind in ('ndrf_team','general_rescue') end;
$$;

-- Every mutation obtains this same transaction-scoped advisory lock. The demo
-- has a small dataset; serializing these short writes is easy to explain and
-- also protects the "no existing incident" case, where no row exists to lock.
-- Never perform network calls while holding a database transaction/lock.
create or replace function public.dispatch_incident(p_incident_id uuid, p_is_auto boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_incident public.incidents%rowtype;
  v_unit public.units%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_distance double precision;
  v_label text;
  v_now timestamptz;
begin
  perform pg_advisory_xact_lock(50505);
  v_now := clock_timestamp();
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if v_incident.status <> 'open' then return jsonb_build_object('status','incident_resolved'); end if;
  select * into v_dispatch from public.dispatches where incident_id = p_incident_id and status in ('en_route','on_scene');
  if found then return jsonb_build_object('status','already_assigned','dispatch',to_jsonb(v_dispatch)); end if;
  if v_incident.lat is null then return jsonb_build_object('status','location_unverified'); end if;

  select u.* into v_unit from public.units u
  where u.status = 'available' and u.current_incident_id is null and u.is_demo = v_incident.is_demo
    and public.dm_unit_compatible(v_incident.emergency_type, u.unit_type)
  order by public.dm_haversine_m(u.lat,u.lng,v_incident.lat,v_incident.lng), u.id
  limit 1 for update;
  if not found then return jsonb_build_object('status','no_compatible_unit'); end if;
  v_distance := public.dm_haversine_m(v_unit.lat,v_unit.lng,v_incident.lat,v_incident.lng);
  v_label := case v_unit.unit_type when 'rescue_boat' then 'boat' when 'fire_engine' then 'fire engine'
    when 'ndrf_team' then 'NDRF team' when 'general_rescue' then 'general rescue unit' else 'ambulance' end;
  update public.units set status = 'en_route', current_incident_id = p_incident_id,
    last_moved_at = v_now, updated_at = v_now where id = v_unit.id and status = 'available';
  if not found then raise exception 'Unit reservation conflict' using errcode = '40001'; end if;
  insert into public.dispatches (incident_id,unit_id,distance_m,eta_seconds,reasoning,is_auto,is_demo,dispatched_at)
  values (p_incident_id,v_unit.id,v_distance,ceil(v_distance / (30.0 * 1000 / 3600))::integer,
    format('Unit %s chosen: nearest available compatible %s, %s km',v_unit.id,v_label,round((v_distance/1000)::numeric,1)),
    p_is_auto,v_incident.is_demo,v_now) returning * into v_dispatch;
  insert into public.audit_log (action,actor,incident_id,unit_id,metadata,is_demo)
  values ('unit.dispatched',case when p_is_auto then 'system' else 'dispatcher' end,p_incident_id,v_unit.id,
    jsonb_build_object('dispatch_id',v_dispatch.id,'distance_m',v_distance,'eta_seconds',v_dispatch.eta_seconds,'is_auto',p_is_auto),v_incident.is_demo);
  return jsonb_build_object('status','dispatched','dispatch',to_jsonb(v_dispatch));
end;
$$;

create or replace function public.ingest_report(p_report jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_report public.reports%rowtype;
  v_incident public.incidents%rowtype;
  v_now timestamptz;
  v_request_id uuid;
  v_type public.emergency_type;
  v_score integer;
  v_lat double precision;
  v_lng double precision;
  v_demo boolean;
  v_distance double precision;
  v_count integer;
  v_base_rank integer;
  v_final_rank integer;
  v_max_score integer;
  v_outcome text := 'new';
  v_dispatch jsonb := null;
  v_explanation text;
begin
  perform pg_advisory_xact_lock(50505);
  v_now := clock_timestamp();
  v_request_id := (p_report->>'client_request_id')::uuid;
  if v_request_id is null then raise exception 'client_request_id is required' using errcode = '22023'; end if;
  select * into v_report from public.reports where client_request_id = v_request_id;
  if found then
    select * into v_incident from public.incidents where id = v_report.incident_id;
    select jsonb_build_object('status','already_assigned','dispatch',to_jsonb(d)) into v_dispatch
      from public.dispatches d where incident_id = v_report.incident_id and status in ('en_route','on_scene');
    v_explanation := case when v_report.cluster_outcome = 'new' then 'New incident created' else
      format('Merged with Incident #%s (distance %s m, %s reports)',v_incident.incident_number,
        round(v_report.match_distance_m::numeric),v_incident.report_count) end;
    return jsonb_build_object('replayed',true,'report',to_jsonb(v_report)-'image_data_url','incident',to_jsonb(v_incident),
      'cluster_explanation',v_explanation,'dispatch_result',v_dispatch);
  end if;
  v_type := (p_report->>'emergency_type')::public.emergency_type;
  v_score := (p_report->>'final_score')::integer;
  if v_score is null or v_score not between 0 and 100 then raise exception 'Invalid score' using errcode = '22023'; end if;
  v_lat := (p_report->>'lat')::double precision;
  v_lng := (p_report->>'lng')::double precision;
  v_demo := coalesce((p_report->>'is_demo')::boolean,false);
  if v_lat is not null and v_lng is not null then
    select i.* into v_incident from public.incidents i
    where i.status = 'open' and i.is_demo = v_demo and i.lat is not null
      and i.last_report_at between v_now - interval '60 minutes' and v_now
      and public.dm_types_compatible(i.emergency_type,v_type)
      and public.dm_haversine_m(v_lat,v_lng,i.lat,i.lng) <= 300
    order by public.dm_haversine_m(v_lat,v_lng,i.lat,i.lng),i.id limit 1 for update;
  end if;
  if v_incident.id is not null then
    v_outcome := 'merged';
    v_distance := public.dm_haversine_m(v_lat,v_lng,v_incident.lat,v_incident.lng);
  else
    insert into public.incidents (emergency_type,severity,final_score,location_label,lat,lng,is_demo,created_at,last_report_at)
    values (v_type,public.dm_severity(v_score),v_score,p_report->>'location_label',v_lat,v_lng,v_demo,v_now,v_now)
    returning * into v_incident;
  end if;

  insert into public.reports (client_request_id,incident_id,channel,raw_text,image_description,image_data_url,
    location_label,location_source,lat,lng,emergency_type,people_count,vulnerable_groups,severity,final_score,
    entities,reasoning,cluster_outcome,match_distance_m,is_demo,created_at)
  values (v_request_id,v_incident.id,(p_report->>'channel')::public.report_channel,coalesce(p_report->>'raw_text',''),
    p_report->>'image_description',p_report->>'image_data_url',p_report->>'location_label',
    (p_report->>'location_source')::public.location_source,v_lat,v_lng,v_type,(p_report->>'people_count')::integer,
    array(select jsonb_array_elements_text(coalesce(p_report->'vulnerable_groups','[]'::jsonb)))::public.vulnerable_group[],
    public.dm_severity(v_score),v_score,p_report->'entities',p_report->'reasoning',v_outcome,v_distance,v_demo,v_now)
  returning * into v_report;

  select count(*)::integer,avg(lat),avg(lng),max(public.dm_severity_rank(severity)),max(final_score)
    into v_count,v_lat,v_lng,v_base_rank,v_max_score from public.reports where incident_id = v_incident.id;
  v_final_rank := greatest(public.dm_severity_rank(v_incident.severity),least(3,v_base_rank + case when v_count >= 3 then 1 else 0 end));
  update public.incidents set report_count = v_count,lat = v_lat,lng = v_lng,last_report_at = v_now,updated_at = v_now,
    severity = (array['Low','Medium','High','Critical']::public.severity_level[])[v_final_rank+1],
    final_score = greatest(v_max_score,v_final_rank*25),
    cluster_reasoning = jsonb_build_object('radius_m',300,'window_minutes',60,'last_match_distance_m',v_distance,
      'report_count',v_count,'corroboration_applied',v_count >= 3,'base_severity',
      (array['Low','Medium','High','Critical'])[v_base_rank+1],'rule','Highest report severity plus one tier for 3+ reports; never downgrade')
  where id = v_incident.id returning * into v_incident;
  v_explanation := case when v_outcome = 'new' then 'New incident created' else
    format('Merged with Incident #%s (distance %s m, %s reports)',v_incident.incident_number,round(v_distance::numeric),v_count) end;
  insert into public.audit_log (action,actor,incident_id,report_id,metadata,is_demo)
  values ('report.'||v_outcome,case when p_report->>'origin' = 'seed' then 'simulation' else 'citizen' end,v_incident.id,v_report.id,
    jsonb_build_object('distance_m',v_distance,'report_count',v_count,'severity',v_incident.severity),v_demo);
  if v_incident.severity = 'Critical' then v_dispatch := public.dispatch_incident(v_incident.id,true); end if;
  return jsonb_build_object('replayed',false,'report',to_jsonb(v_report)-'image_data_url',
    'incident',to_jsonb(v_incident),'cluster_explanation',v_explanation,'dispatch_result',v_dispatch);
end;
$$;

create or replace function public.resolve_incident(p_incident_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_incident public.incidents%rowtype;
  v_now timestamptz;
begin
  perform pg_advisory_xact_lock(50505);
  v_now := clock_timestamp();
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if v_incident.status = 'resolved' then return jsonb_build_object('status','already_resolved','incident',to_jsonb(v_incident)); end if;
  update public.incidents set status = 'resolved',resolved_at = v_now,updated_at = v_now
    where id = p_incident_id returning * into v_incident;
  update public.units set status = 'returning',last_moved_at = v_now,updated_at = v_now
    where current_incident_id = p_incident_id and status in ('en_route','on_scene');
  update public.dispatches set status = 'returning',returning_at = v_now
    where incident_id = p_incident_id and status in ('en_route','on_scene');
  insert into public.audit_log (action,actor,incident_id,is_demo)
    values ('incident.resolved','dispatcher',p_incident_id,v_incident.is_demo);
  return jsonb_build_object('status','resolved','incident',to_jsonb(v_incident));
end;
$$;

-- Multiplier accelerates DEMO units only. ETA remains based on 30 km/h.
-- last_moved_at is persisted per unit, so extra tabs do not speed up time.
create or replace function public.tick_simulation(p_demo_multiplier double precision default 15)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_unit public.units%rowtype;
  v_now timestamptz;
  v_target_lat double precision;
  v_target_lng double precision;
  v_distance double precision;
  v_step double precision;
  v_fraction double precision;
  v_moved integer := 0;
  v_arrived integer := 0;
  v_returned integer := 0;
begin
  if p_demo_multiplier is null or p_demo_multiplier not between 1 and 60 then raise exception 'Invalid demo multiplier' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(50505);
  v_now := clock_timestamp();
  for v_unit in select * from public.units where status in ('en_route','returning') order by id for update loop
    if v_unit.status = 'returning' then
      v_target_lat := v_unit.station_lat; v_target_lng := v_unit.station_lng;
    else
      select lat,lng into v_target_lat,v_target_lng from public.incidents where id = v_unit.current_incident_id;
    end if;
    if v_target_lat is null or v_target_lng is null then continue; end if;
    v_distance := public.dm_haversine_m(v_unit.lat,v_unit.lng,v_target_lat,v_target_lng);
    v_step := greatest(0,extract(epoch from v_now - v_unit.last_moved_at)) * (30.0*1000/3600)
      * case when v_unit.is_demo then p_demo_multiplier else 1 end;
    v_moved := v_moved + 1;
    if v_distance <= 5 or v_step >= v_distance then
      update public.units set lat = v_target_lat,lng = v_target_lng,last_moved_at = v_now,updated_at = v_now,
        status = case when v_unit.status = 'returning' then 'available' else 'on_scene' end::public.unit_status,
        current_incident_id = case when v_unit.status = 'returning' then null else v_unit.current_incident_id end
        where id = v_unit.id;
      if v_unit.status = 'returning' then
        update public.dispatches set status = 'completed',completed_at = v_now where unit_id = v_unit.id and status = 'returning';
        v_returned := v_returned + 1;
      else
        update public.dispatches set status = 'on_scene',arrived_at = v_now where unit_id = v_unit.id and status = 'en_route';
        v_arrived := v_arrived + 1;
      end if;
      insert into public.audit_log (action,actor,incident_id,unit_id,is_demo)
      values (case when v_unit.status = 'returning' then 'unit.available' else 'unit.on_scene' end,'simulation',v_unit.current_incident_id,v_unit.id,v_unit.is_demo);
    else
      v_fraction := v_step / v_distance;
      update public.units set lat = v_unit.lat+(v_target_lat-v_unit.lat)*v_fraction,
        lng = v_unit.lng+(v_target_lng-v_unit.lng)*v_fraction,last_moved_at = v_now,updated_at = v_now where id = v_unit.id;
    end if;
  end loop;
  return jsonb_build_object('moved',v_moved,'arrived',v_arrived,'returned',v_returned,'at',v_now);
end;
$$;

-- Postgres functions otherwise default to PUBLIC EXECUTE. Restrict every
-- function created here, including pure helpers, to the server credential.
do $$
declare v_function regprocedure;
begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array['dm_haversine_m','dm_severity','dm_severity_rank',
      'dm_types_compatible','dm_unit_compatible','dispatch_incident','ingest_report','resolve_incident','tick_simulation'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated',v_function);
    execute format('grant execute on function %s to service_role',v_function);
  end loop;
end $$;

commit;
