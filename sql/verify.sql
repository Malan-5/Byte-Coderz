-- Read-only checks to run in Supabase SQL Editor after schema.sql and seed.sql.
-- Fresh demo: 12 incidents, 17 reports, 14 units, 3 en-route dispatches.
select 'incidents' as entity,count(*) as count from public.incidents where is_demo
union all select 'reports',count(*) from public.reports where is_demo
union all select 'units',count(*) from public.units where is_demo
union all select 'active_dispatches',count(*) from public.dispatches where is_demo and status in ('en_route','on_scene');

-- Expect Velachery: flood / High / 2 reports / open / approximately 12.9815,80.2180.
select incident_number,location_label,emergency_type,severity,report_count,status,lat,lng,
  round(extract(epoch from now()-last_report_at)) as seconds_since_report
from public.incidents where is_demo and location_label = 'Velachery';

-- Every row must show rls_enabled=true and public_policy_count=0.
select c.relname as table_name,c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as public_policy_count
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('reports','incidents','units','dispatches','audit_log');

-- Expect false / false / true for all mutations.
select name,
  has_function_privilege('anon',name,'execute') as anon_can_execute,
  has_function_privilege('authenticated',name,'execute') as authenticated_can_execute,
  has_function_privilege('service_role',name,'execute') as server_can_execute
from (values ('public.ingest_report(jsonb)'),('public.dispatch_incident(uuid,boolean)'),
  ('public.resolve_incident(uuid)'),('public.tick_simulation(double precision)'),('public.seed_demo(boolean)')) as rpc(name);

-- Expect zero rows: materialized counts and centroids must match their reports.
select i.id,i.report_count,count(r.id) as actual_count
from public.incidents i left join public.reports r on r.incident_id=i.id
group by i.id having i.report_count <> count(r.id)
  or abs(i.lat-avg(r.lat))>0.00000001 or abs(i.lng-avg(r.lng))>0.00000001;
