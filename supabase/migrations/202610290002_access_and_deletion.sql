-- Membership is provisioned by an administrator. No public invitations in v1.
create table public.workspace_members (
  workspace uuid not null references auth.users(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('curator','reviewer','approver')),
  primary key (workspace,user_id)
);
create index workspace_members_user on public.workspace_members(user_id);
create table public.document_deletions (
  id text primary key, workspace uuid not null references auth.users(id),
  queued_at timestamptz not null default now()
);
alter table public.workspace_members enable row level security;
alter table public.document_deletions enable row level security;
revoke all on public.workspace_members, public.document_deletions from anon, authenticated;

create function public.delete_purchase(p_id uuid, p_owner uuid, p_expected integer)
returns boolean language plpgsql security invoker set search_path=public as $$
declare old_data jsonb; proposal jsonb;
begin
  select data into old_data from purchases where id=p_id and owner=p_owner and version=p_expected for update;
  if not found then return false; end if;
  for proposal in select * from jsonb_array_elements(old_data->'proposals') loop
    if proposal->>'documentId' is not null then
      insert into document_deletions(id,workspace) values(proposal->>'documentId',p_owner) on conflict(id) do nothing;
    end if;
  end loop;
  delete from purchases where id=p_id and owner=p_owner and version=p_expected;
  return true;
end $$;
revoke all on function public.delete_purchase(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.delete_purchase(uuid,uuid,integer) to service_role;
