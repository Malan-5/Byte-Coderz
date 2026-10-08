-- Run AFTER schema.sql. The first run inserts data. A repeat does not erase it.
-- The authenticated /api/seed route will call seed_demo(true) for Reset Demo.
begin;

create or replace function public.seed_demo(p_reset boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_seed record;
  v_j integer;
  v_offset double precision;
  v_result jsonb;
  v_unit_ids text[] := array['R-01','R-02','R-03','N-01','N-02','N-03','A-01','A-02','A-03','F-01','F-02','F-03','G-01','G-02'];
begin
  perform pg_advisory_xact_lock(50505);
  if not coalesce(p_reset,false) and (exists(select 1 from public.incidents where is_demo) or exists(select 1 from public.units where is_demo)) then
    return jsonb_build_object('status','already_seeded','message','Existing demo retained. Use authenticated Reset Demo to refresh it.');
  end if;
  if exists(select 1 from public.units where id = any(v_unit_ids) and not is_demo) then
    raise exception 'Seed unit IDs conflict with non-demo units' using errcode = '22023';
  end if;
  -- Never remove a real report/assignment just because it references a demo row.
  if exists(select 1 from public.reports r join public.incidents i on i.id = r.incident_id where i.is_demo and not r.is_demo)
    or exists(select 1 from public.dispatches d join public.incidents i on i.id = d.incident_id where i.is_demo and not d.is_demo)
    or exists(select 1 from public.units u join public.incidents i on i.id = u.current_incident_id where i.is_demo and not u.is_demo)
    or exists(select 1 from public.dispatches d join public.units u on u.id = d.unit_id where u.is_demo and not d.is_demo)
  then raise exception 'Demo rows are referenced by non-demo data; reset refused' using errcode = '22023'; end if;

  if p_reset then
    delete from public.dispatches where is_demo;
    delete from public.reports where is_demo;
    delete from public.units where is_demo;
    delete from public.incidents where is_demo;
    -- Audit rows remain, with deleted entity references set to NULL by their FKs.
  end if;

  insert into public.units (id,name,unit_type,station_name,lat,lng,station_lat,station_lng,is_demo)
  select id,name,kind::public.unit_type,station,lat,lng,lat,lng,true from (values
    ('R-01','Velachery boat 1','rescue_boat','Velachery staging point',12.9765,80.2160),
    ('R-02','Pallikaranai boat 2','rescue_boat','Pallikaranai staging point',12.9290,80.2070),
    ('R-03','Adyar boat 3','rescue_boat','Adyar staging point',13.0050,80.2520),
    ('N-01','Guindy NDRF team','ndrf_team','Guindy staging point',13.0080,80.2200),
    ('N-02','Sholinganallur NDRF team','ndrf_team','Sholinganallur staging point',12.9080,80.2250),
    ('N-03','Perambur NDRF team','ndrf_team','Perambur staging point',13.1200,80.2300),
    ('A-01','Adyar ambulance','ambulance','Adyar medical staging',13.0080,80.2580),
    ('A-02','Anna Nagar ambulance','ambulance','Anna Nagar medical staging',13.0890,80.2150),
    ('A-03','Tambaram ambulance','ambulance','Tambaram medical staging',12.9310,80.1030),
    ('F-01','T. Nagar fire engine','fire_engine','T. Nagar fire staging',13.0450,80.2380),
    ('F-02','Royapuram fire engine','fire_engine','Royapuram fire staging',13.1160,80.2900),
    ('F-03','Tambaram fire engine','fire_engine','Tambaram fire staging',12.9190,80.1050),
    ('G-01','Central general rescue','general_rescue','Kodambakkam staging point',13.0530,80.2290),
    ('G-02','North general rescue','general_rescue','Anna Nagar staging point',13.0800,80.2050)
  ) as stations(id,name,kind,station,lat,lng);

  -- Locality coordinates are deliberately the same as shared/gazetteer.ts.
  -- All timestamps come from ingest_report at reset time (never fixed in 2026).
  -- Scores are labelled simulated fixtures, not claimed as actual LLM output.
  for v_seed in select * from (values
    ('Velachery','flood',12.9815,80.2180,55,2,'Water has entered homes in Velachery. Residents need evacuation.'),
    ('Pallikaranai','flood',12.9346,80.2101,62,3,'Floodwater is rising in Pallikaranai; several residents need rescue.'),
    ('Madipakkam','trapped',12.9648,80.2080,63,1,'Residents are stranded on an upper floor in Madipakkam.'),
    ('Adyar','flood',13.0012,80.2565,40,2,'Waterlogging in Adyar is blocking access to homes.'),
    ('Tambaram','medical',12.9249,80.1000,90,1,'An unconscious person in Tambaram needs an ambulance.'),
    ('T. Nagar','fire',13.0418,80.2341,86,1,'A building fire in T. Nagar threatens nearby residents.'),
    ('Perambur','collapse',13.1148,80.2328,67,1,'A wall collapsed in Perambur; the area needs rescue support.'),
    ('Royapuram','other',13.1137,80.2950,15,1,'A shelter in Royapuram requests drinking water.'),
    ('Guindy','trapped',13.0067,80.2206,42,1,'Access to a building is blocked in Guindy; evacuation help requested.'),
    ('Sholinganallur','flood',12.9009,80.2279,57,2,'Flooding near homes in Sholinganallur; evacuation requested.'),
    ('Mylapore','medical',13.0339,80.2692,35,1,'A stable injured resident in Mylapore needs medical transport.'),
    ('Anna Nagar','other',13.0850,80.2101,18,1,'A shelter in Anna Nagar requests food and water.')
  ) as seeds(label,kind,lat,lng,score,report_count,message)
  loop
    for v_j in 1..v_seed.report_count loop
      -- Symmetric offsets make the final mean equal to the locality centre.
      v_offset := (v_j - (v_seed.report_count + 1) / 2.0) * 0.0003;
      v_result := public.ingest_report(jsonb_build_object(
        'client_request_id',gen_random_uuid(),'origin','seed','channel',case when v_j % 2 = 0 then 'voice' else 'text' end,
        'raw_text',v_seed.message,'location_label',v_seed.label,'location_source','gazetteer',
        'lat',v_seed.lat+v_offset,'lng',v_seed.lng-v_offset,'emergency_type',v_seed.kind,
        'people_count',null,'vulnerable_groups','[]'::jsonb,'final_score',v_seed.score,'is_demo',true,
        'entities',jsonb_build_object('location_mentions',jsonb_build_array(v_seed.label),
          'emergency_type',v_seed.kind,'people_count',null,'vulnerable_groups','[]'::jsonb),
        'reasoning',jsonb_build_object('version','seed-v1','source','simulated fixture','keyword_hits','[]'::jsonb,
          'modifiers','[]'::jsonb,'llm_status','unavailable','llm_output',null,'final_score',v_seed.score,
          'explanation','Simulated ongoing crisis report; score supplied by seed data')
      ));
    end loop;
  end loop;
  insert into public.audit_log (action,actor,metadata,is_demo)
  values (case when p_reset then 'demo.reset' else 'demo.seeded' end,'dispatcher',
    jsonb_build_object('incidents',12,'reports',17,'units',14),true);
  return jsonb_build_object('status','seeded','incidents',(select count(*) from public.incidents where is_demo),
    'reports',(select count(*) from public.reports where is_demo),'units',(select count(*) from public.units where is_demo),
    'active_dispatches',(select count(*) from public.dispatches where is_demo and status = 'en_route'));
end;
$$;

revoke all on function public.seed_demo(boolean) from public, anon, authenticated;
grant execute on function public.seed_demo(boolean) to service_role;

select public.seed_demo(false);
commit;
