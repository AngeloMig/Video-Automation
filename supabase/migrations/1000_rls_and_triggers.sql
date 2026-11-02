-- Hand-written: tenant isolation, role permissions and signup bootstrap.
-- Numbered 1000 so Drizzle-generated schema migrations (0000, 0001, ...) can sort before it.
-- A later schema migration that adds a table must also add that table's policies.

alter table public.users
  add constraint users_auth_fk foreign key (id) references auth.users (id) on delete cascade;

create or replace function public.is_workspace_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target and m.user_id = auth.uid()
  )
$$;

create or replace function public.has_workspace_role(target uuid, allowed public.workspace_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target and m.user_id = auth.uid() and m.role = any (allowed)
  )
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;

-- Tables viewers can read and editors, admins and owners can change.
do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'project_settings', 'niche_keywords', 'discovery_sources', 'discovered_videos',
    'media_assets', 'source_assets', 'asset_licenses', 'transcripts', 'content_ideas',
    'video_projects', 'video_project_versions', 'scripts', 'video_scenes', 'timeline_tracks',
    'production_jobs', 'agent_controls', 'publishing_jobs', 'scheduled_posts', 'automation_rules'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      t || '_read', t);
    execute format(
      $f$create policy %I on public.%I for all to authenticated
         using (public.has_workspace_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))
         with check (public.has_workspace_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))$f$,
      t || '_write', t);
  end loop;
end $$;

-- Tables members can only read. The worker writes these with the owner connection.
do $$
declare t text;
begin
  foreach t in array array['subscriptions', 'agent_task_logs', 'rendered_videos', 'analytics_snapshots', 'usage_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      t || '_read', t);
  end loop;
end $$;

alter table public.users enable row level security;
create policy users_read on public.users for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = public.users.id
  )
);
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table public.workspaces enable row level security;
create policy workspaces_read on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.has_workspace_role(id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(id, array['owner','admin']::public.workspace_role[]));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

alter table public.workspace_members enable row level security;
create policy members_read on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy members_owner_write on public.workspace_members for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]));
-- Admins manage members but cannot touch owners or grant ownership.
create policy members_admin_write on public.workspace_members for all to authenticated
  using (role <> 'owner' and public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]))
  with check (role <> 'owner' and public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

-- Token columns stay out of reach of request connections, even for owners.
alter table public.social_accounts enable row level security;
revoke all on public.social_accounts from authenticated;
grant select (id, workspace_id, project_id, platform, external_account_id, display_name, token_expires_at, scopes, created_at, updated_at)
  on public.social_accounts to authenticated;
grant delete on public.social_accounts to authenticated;
create policy social_accounts_read on public.social_accounts for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy social_accounts_delete on public.social_accounts for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id is null or user_id = auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id is null or user_id = auth.uid()))
  with check (public.is_workspace_member(workspace_id));

alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and actor_id = auth.uid());

alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from authenticated;

-- Every new login gets a profile, a personal workspace and the starter plan.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare new_workspace uuid;
begin
  insert into public.users (id, email, display_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'display_name');

  insert into public.workspaces (name)
  values (coalesce(new.raw_user_meta_data ->> 'workspace_name', split_part(coalesce(new.email, 'My'), '@', 1) || '''s workspace'))
  returning id into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role) values (new_workspace, new.id, 'owner');
  insert into public.subscriptions (workspace_id, plan) values (new_workspace, 'starter');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
