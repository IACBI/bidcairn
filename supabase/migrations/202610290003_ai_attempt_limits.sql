create table public.ai_attempts (scope text primary key, attempts integer not null check(attempts between 1 and 2));
alter table public.ai_attempts enable row level security;
revoke all on public.ai_attempts from anon, authenticated;
drop function public.reserve_ai(uuid,integer,numeric,integer,numeric);
create function public.reserve_ai(p_id uuid, p_tokens integer, p_cost numeric, p_max_tokens integer, p_max_cost numeric, p_scope text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare used_cost numeric; used_tokens bigint; calls integer;
begin
  perform pg_advisory_xact_lock(7961842);
  select attempts into calls from ai_attempts where scope=p_scope;
  if coalesce(calls,0) >= 2 then return false; end if;
  select coalesce(sum(cost),0), coalesce(sum(case when day=current_date then tokens else 0 end),0) into used_cost,used_tokens from ai_reservations;
  if p_tokens < 0 or p_cost < 0 or used_cost+p_cost > p_max_cost or used_tokens+p_tokens > p_max_tokens then return false; end if;
  insert into ai_reservations(id,tokens,cost) values(p_id,p_tokens,p_cost);
  insert into ai_attempts values(p_scope,1) on conflict(scope) do update set attempts=ai_attempts.attempts+1;
  return true;
end $$;
revoke all on function public.reserve_ai(uuid,integer,numeric,integer,numeric,text) from public, anon, authenticated;
grant execute on function public.reserve_ai(uuid,integer,numeric,integer,numeric,text) to service_role;
