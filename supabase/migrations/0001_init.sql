-- Family Kosh schema.
-- Model: every account owns a "self" person. An account can also manage people who have no login
-- (for example parents). Families are opt-in groups of people; being in a family lets its members
-- see each other's (non-private) holdings and goals. Only the person, or whoever manages them, can edit.
-- All access is enforced here with row-level security; the anon key in the app grants nothing on its own.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users on delete set null,
  manager_id uuid references auth.users on delete set null,
  name text not null check (length(name) between 1 and 80),
  relation text not null default '',
  color text not null default '#3B5BDB',
  risk text not null default 'balanced' check (risk in ('conservative','balanced','growth')),
  income numeric not null default 0 check (income >= 0),
  expenses numeric check (expenses is null or expenses >= 0),
  notes text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (user_id is not null or manager_id is not null)
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families on delete cascade,
  person_id uuid not null references public.people on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  added_at timestamptz not null default now(),
  primary key (family_id, person_id)
);

create table public.family_invites (
  code text primary key default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  family_id uuid not null references public.families on delete cascade,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table public.person_claims (
  code text primary key default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  person_id uuid not null references public.people on delete cascade,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table public.price_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text not null check (length(label) between 1 and 80),
  unit text not null check (length(unit) between 1 and 30),
  price numeric,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.price_points (
  series_id uuid not null references public.price_series on delete cascade,
  d date not null,
  price numeric not null,
  primary key (series_id, d)
);

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users on delete set null,
  name text not null check (length(name) between 1 and 120),
  cls text not null,
  place text not null default '',
  mode text not null default 'value' check (mode in ('value','units')),
  value numeric,
  units numeric,
  price_series_id uuid references public.price_series on delete set null,
  rate numeric,
  liq text check (liq is null or liq in ('instant','week','locked','illiquid')),
  payout boolean not null default false,
  sip numeric check (sip is null or sip >= 0),
  sip_source text not null default 'cash' check (sip_source in ('cash','payroll')),
  paid_by uuid references public.people on delete set null,
  include_in_nw boolean not null default true,
  estimate boolean not null default false,
  private boolean not null default false,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.holding_owners (
  holding_id uuid not null references public.holdings on delete cascade,
  person_id uuid not null references public.people on delete cascade,
  share numeric not null default 1 check (share > 0),
  primary key (holding_id, person_id)
);

create table public.holding_snapshots (
  holding_id uuid not null references public.holdings on delete cascade,
  d date not null,
  value numeric,
  units numeric,
  primary key (holding_id, d)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people on delete cascade,
  name text not null check (length(name) between 1 and 120),
  target numeric not null check (target >= 0),
  target_month date not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.goal_links (
  goal_id uuid not null references public.goals on delete cascade,
  holding_id uuid not null references public.holdings on delete cascade,
  primary key (goal_id, holding_id)
);

-- Market views written by an external signal source (for example InvestBot) with the service role.
create table public.signals (
  id bigint generated always as identity primary key,
  source text not null,
  as_of date not null default current_date,
  views jsonb not null,
  created_at timestamptz not null default now()
);

create index on public.people (manager_id);
create index on public.family_members (person_id);
create index on public.holding_owners (person_id);
create index on public.goals (person_id);
create index on public.goal_links (holding_id);

-- ───────────────────────── access helpers ─────────────────────────
-- SECURITY DEFINER so policies can consult other tables without recursive RLS.

create or replace function public.my_people() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from people where user_id = auth.uid() or manager_id = auth.uid()
$$;

create or replace function public.my_self() returns uuid
language sql stable security definer set search_path = public as $$
  select id from people where user_id = auth.uid()
$$;

create or replace function public.my_families() returns setof uuid
language sql stable security definer set search_path = public as $$
  select family_id from family_members where person_id = (select id from people where user_id = auth.uid())
$$;

create or replace function public.is_family_admin(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_members
    where family_id = fid and role = 'admin' and person_id = (select id from people where user_id = auth.uid()))
$$;

create or replace function public.can_manage_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where id = pid and (user_id = auth.uid() or manager_id = auth.uid()))
$$;

create or replace function public.can_view_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_person(pid) or exists (
    select 1 from family_members fm where fm.person_id = pid and fm.family_id in (select public.my_families()))
$$;

create or replace function public.can_edit_holding(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  -- The creator controls a holding only until it has owners; after that, ownership decides.
  select exists (select 1 from holdings h where h.id = hid and h.created_by = auth.uid()
                   and not exists (select 1 from holding_owners o where o.holding_id = hid))
      or exists (select 1 from holding_owners o where o.holding_id = hid and public.can_manage_person(o.person_id))
$$;

create or replace function public.can_view_holding(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_edit_holding(hid) or exists (
    select 1 from holdings h join holding_owners o on o.holding_id = h.id
    where h.id = hid and not h.private and public.can_view_person(o.person_id))
$$;

create or replace function public.is_family_mate(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select uid = auth.uid() or exists (
    select 1 from family_members fm join people p on p.id = fm.person_id
    where p.user_id = uid and fm.family_id in (select public.my_families()))
$$;

create or replace function public.can_view_series(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from price_series s where s.id = sid and public.is_family_mate(s.owner_id))
      or exists (select 1 from holdings h where h.price_series_id = sid and public.can_view_holding(h.id))
$$;

-- ───────────────────────── row-level security ─────────────────────────

alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invites enable row level security;
alter table public.person_claims enable row level security;
alter table public.price_series enable row level security;
alter table public.price_points enable row level security;
alter table public.holdings enable row level security;
alter table public.holding_owners enable row level security;
alter table public.holding_snapshots enable row level security;
alter table public.goals enable row level security;
alter table public.goal_links enable row level security;
alter table public.signals enable row level security;

create policy "profiles: read self and family" on public.profiles for select using (public.is_family_mate(id));
create policy "profiles: update self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "people: read" on public.people for select using (public.can_view_person(id));
create policy "people: add someone you manage" on public.people for insert
  with check (manager_id = auth.uid() and user_id is null);
create policy "people: edit" on public.people for update using (public.can_manage_person(id));
create policy "people: delete managed" on public.people for delete using (manager_id = auth.uid() and user_id is null);

create policy "families: read" on public.families for select
  using (id in (select public.my_families()) or created_by = auth.uid());
create policy "families: create" on public.families for insert with check (created_by = auth.uid());
create policy "families: rename" on public.families for update using (public.is_family_admin(id));
create policy "families: delete" on public.families for delete using (public.is_family_admin(id));

create policy "members: read" on public.family_members for select using (family_id in (select public.my_families()));
create policy "members: admins add people they manage" on public.family_members for insert
  with check (public.is_family_admin(family_id) and public.can_manage_person(person_id));
create policy "members: admins change roles" on public.family_members for update using (public.is_family_admin(family_id));
create policy "members: remove" on public.family_members for delete
  using (public.is_family_admin(family_id) or public.can_manage_person(person_id));

create policy "invites: admins" on public.family_invites for all
  using (public.is_family_admin(family_id)) with check (public.is_family_admin(family_id));

create policy "claims: managers" on public.person_claims for all
  using (created_by = auth.uid()) with check (created_by = auth.uid() and public.can_manage_person(person_id));

create policy "series: read" on public.price_series for select using (public.can_view_series(id));
create policy "series: create" on public.price_series for insert with check (owner_id = auth.uid());
create policy "series: edit" on public.price_series for update using (public.is_family_mate(owner_id));
create policy "series: delete" on public.price_series for delete using (owner_id = auth.uid());

create policy "points: read" on public.price_points for select using (public.can_view_series(series_id));
create policy "points: write" on public.price_points for all
  using (exists (select 1 from price_series s where s.id = series_id and public.is_family_mate(s.owner_id)))
  with check (exists (select 1 from price_series s where s.id = series_id and public.is_family_mate(s.owner_id)));

create policy "holdings: read" on public.holdings for select using (public.can_view_holding(id));
create policy "holdings: create" on public.holdings for insert with check (created_by = auth.uid());
create policy "holdings: edit" on public.holdings for update using (public.can_edit_holding(id));
create policy "holdings: delete" on public.holdings for delete using (public.can_edit_holding(id));

create policy "owners: read" on public.holding_owners for select using (public.can_view_holding(holding_id));
create policy "owners: write" on public.holding_owners for all
  using (public.can_edit_holding(holding_id))
  with check (public.can_edit_holding(holding_id) and public.can_view_person(person_id));

create policy "snapshots: read" on public.holding_snapshots for select using (public.can_view_holding(holding_id));
create policy "snapshots: write" on public.holding_snapshots for all
  using (public.can_edit_holding(holding_id)) with check (public.can_edit_holding(holding_id));

create policy "goals: read" on public.goals for select using (public.can_view_person(person_id));
create policy "goals: write" on public.goals for all
  using (public.can_manage_person(person_id)) with check (public.can_manage_person(person_id));

create policy "links: read" on public.goal_links for select
  using (exists (select 1 from goals g where g.id = goal_id and public.can_view_person(g.person_id)));
create policy "links: write" on public.goal_links for all
  using (exists (select 1 from goals g where g.id = goal_id and public.can_manage_person(g.person_id)))
  with check (exists (select 1 from goals g where g.id = goal_id and public.can_manage_person(g.person_id))
              and public.can_view_holding(holding_id));

create policy "signals: read" on public.signals for select to authenticated using (true);

-- Columns that must never change from the client.
revoke update on public.people from authenticated, anon;
grant update (name, relation, color, risk, income, expenses, notes, sort) on public.people to authenticated;
revoke update on public.holdings from authenticated, anon;
grant update (name, cls, place, mode, value, units, price_series_id, rate, liq, payout, sip, sip_source, paid_by,
  include_in_nw, estimate, private, notes, updated_at) on public.holdings to authenticated;
revoke update on public.price_series from authenticated, anon;
grant update (label, unit, price, note) on public.price_series to authenticated;

-- ───────────────────────── triggers and functions ─────────────────────────

-- Every new account gets a profile and a "self" person.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text := coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'Me');
begin
  insert into profiles (id, display_name) values (new.id, nm) on conflict do nothing;
  insert into people (user_id, name, relation) values (new.id, nm, 'Me') on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Creating a family makes the creator's self person its first admin.
create or replace function public.handle_new_family() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into family_members (family_id, person_id, role)
  select new.id, id, 'admin' from people where user_id = new.created_by;
  return new;
end $$;

create trigger on_family_created after insert on public.families
  for each row execute function public.handle_new_family();

-- Join a family with an invite code. Returns the family id.
create or replace function public.join_family(invite_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid; me uuid;
begin
  select family_id into fid from family_invites where code = upper(trim(invite_code)) and expires_at > now();
  if fid is null then raise exception 'That invite code is wrong or has expired.'; end if;
  select id into me from people where user_id = auth.uid();
  if me is null then raise exception 'Your profile is missing. Sign out and back in.'; end if;
  insert into family_members (family_id, person_id, role) values (fid, me, 'member') on conflict do nothing;
  return fid;
end $$;

-- Take over a person someone else was managing (for example, a partner who now has her own login).
-- Their holdings and goals come along; the caller's empty starter profile is merged into it.
create or replace function public.claim_person(claim_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; old_self uuid;
begin
  select person_id into pid from person_claims where code = upper(trim(claim_code)) and expires_at > now();
  if pid is null then raise exception 'That claim code is wrong or has expired.'; end if;
  if exists (select 1 from people where id = pid and user_id is not null) then
    raise exception 'That person already has a login.'; end if;
  select id into old_self from people where user_id = auth.uid();
  if old_self is not null and old_self <> pid then
    update holding_owners set person_id = pid where person_id = old_self
      and not exists (select 1 from holding_owners o2 where o2.holding_id = holding_owners.holding_id and o2.person_id = pid);
    update goals set person_id = pid where person_id = old_self;
    update holdings set paid_by = pid where paid_by = old_self;
    insert into family_members (family_id, person_id, role)
      select family_id, pid, role from family_members where person_id = old_self on conflict do nothing;
    delete from people where id = old_self;
  end if;
  update people set user_id = auth.uid(), manager_id = null where id = pid;
  delete from person_claims where person_id = pid;
  return pid;
end $$;

-- Record a holding's value (or units) for a date, and keep the current value in step.
create or replace function public.record_snapshot(hid uuid, on_date date, new_value numeric, new_units numeric)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into holding_snapshots (holding_id, d, value, units) values (hid, on_date, new_value, new_units)
  on conflict (holding_id, d) do update set value = excluded.value, units = excluded.units;
  update holdings h set
    value = case when h.mode = 'value' then (select s.value from holding_snapshots s where s.holding_id = hid and s.value is not null order by d desc limit 1) else h.value end,
    units = case when h.mode = 'units' then (select s.units from holding_snapshots s where s.holding_id = hid and s.units is not null order by d desc limit 1) else h.units end,
    estimate = false,
    updated_at = now()
  where h.id = hid;
end $$;

-- Same for a price series.
create or replace function public.record_price(sid uuid, on_date date, new_price numeric)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into price_points (series_id, d, price) values (sid, on_date, new_price)
  on conflict (series_id, d) do update set price = excluded.price;
  update price_series set price = (select p.price from price_points p where p.series_id = sid order by d desc limit 1) where id = sid;
end $$;

revoke execute on function public.join_family(text), public.claim_person(text),
  public.record_snapshot(uuid, date, numeric, numeric), public.record_price(uuid, date, numeric) from public, anon;
grant execute on function public.join_family(text), public.claim_person(text),
  public.record_snapshot(uuid, date, numeric, numeric), public.record_price(uuid, date, numeric) to authenticated;

-- Live updates for open apps (RLS still applies to what each client receives).
alter publication supabase_realtime add table
  public.people, public.families, public.family_members, public.holdings, public.holding_owners,
  public.holding_snapshots, public.price_series, public.price_points, public.goals, public.goal_links;
