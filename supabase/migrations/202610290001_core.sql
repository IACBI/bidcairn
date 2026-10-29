-- All application data is server-only. Authenticated browser clients receive no table grants.
create table public.purchases (
  id uuid primary key, owner uuid not null references auth.users(id), version integer not null,
  data jsonb not null, created_at timestamptz not null default now()
);
create index purchases_owner on public.purchases(owner);
create table public.ai_reservations (id uuid primary key, day date not null default current_date, tokens integer not null check(tokens >= 0), cost numeric not null check(cost >= 0));
create table public.webhook_events (id text primary key, received_at timestamptz not null default now());
alter table public.purchases enable row level security;
alter table public.ai_reservations enable row level security;
alter table public.webhook_events enable row level security;
revoke all on public.purchases, public.ai_reservations, public.webhook_events from anon, authenticated;

create or replace function public.save_purchase(p_id uuid, p_owner uuid, p_version integer, p_expected integer, p_data jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare old_data jsonb; old_event jsonb; i integer;
begin
  if p_data->>'workspaceId' <> p_owner::text or p_data->>'id' <> p_id::text or (p_data->>'version')::integer <> p_version then raise exception 'Invalid purchase envelope'; end if;
  if p_expected is null then
    insert into purchases(id, owner, version, data) values(p_id, p_owner, p_version, p_data);
    return true;
  end if;
  if p_version <> p_expected + 1 then raise exception 'Invalid version'; end if;
  select data into old_data from purchases where id=p_id and owner=p_owner and version=p_expected for update;
  if not found then return false; end if;
  if old_data->'award' is not null and old_data->'award' <> 'null'::jsonb and old_data->'award' is distinct from p_data->'award' then raise exception 'Approved award is immutable'; end if;
  if jsonb_array_length(p_data->'events') < jsonb_array_length(old_data->'events') then raise exception 'Audit events are append-only'; end if;
  for i in 0..jsonb_array_length(old_data->'events')-1 loop
    if old_data->'events'->i is distinct from p_data->'events'->i then raise exception 'Audit events are append-only'; end if;
  end loop;
  update purchases set version = p_version, data = p_data where id = p_id and owner = p_owner and version = p_expected;
  return found;
end $$;

create or replace function public.reserve_ai(p_id uuid, p_tokens integer, p_cost numeric, p_max_tokens integer, p_max_cost numeric)
returns boolean language plpgsql security invoker set search_path = public as $$
declare used_cost numeric; used_tokens bigint;
begin
  perform pg_advisory_xact_lock(7961842);
  select coalesce(sum(cost),0), coalesce(sum(case when day=current_date then tokens else 0 end),0) into used_cost, used_tokens from ai_reservations;
  if p_tokens < 0 or p_cost < 0 or used_cost+p_cost > p_max_cost or used_tokens+p_tokens > p_max_tokens then return false; end if;
  insert into ai_reservations(id,tokens,cost) values(p_id,p_tokens,p_cost);
  return true;
end $$;
revoke all on function public.save_purchase(uuid,uuid,integer,integer,jsonb) from public, anon, authenticated;
revoke all on function public.reserve_ai(uuid,integer,numeric,integer,numeric) from public, anon, authenticated;
grant execute on function public.save_purchase(uuid,uuid,integer,integer,jsonb) to service_role;
grant execute on function public.reserve_ai(uuid,integer,numeric,integer,numeric) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('proposals','proposals',false,10485760,array['application/pdf']) on conflict(id) do nothing;
-- No public Storage policies. Downloads are authorized by the application before service-role retrieval.
