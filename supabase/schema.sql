create extension if not exists pgcrypto;

-- One profile per signed-up organizer. mcp_token is what goes in the MCP URL.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Organizer',
  mcp_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  slug text not null unique,
  approval_limit numeric(12,2) not null default 10000 check (approval_limit >= 0),
  is_public boolean not null default true,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);

create table needs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  item text not null,
  unit text not null default 'units',
  qty_needed numeric(12,2) not null check (qty_needed > 0),
  location text not null default '',
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  created_at timestamptz not null default now()
);

create table contributions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  donor_name text not null,
  type text not null check (type in ('cash','goods','hours')),
  amount numeric(12,2) not null check (amount > 0), -- rupees for cash, quantity for goods/hours
  need_id uuid references needs(id) on delete set null,
  status text not null default 'pledged' check (status in ('pledged','received')),
  created_at timestamptz not null default now()
);

create table spends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  payee text not null,
  amount numeric(12,2) not null check (amount > 0),
  purpose text not null default '',
  need_id uuid references needs(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text,            -- 'auto (under limit)' or the human's name/email
  decided_at timestamptz,
  paid_simulated boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  actor text not null,        -- 'Claude' or the human's display name
  action text not null,       -- e.g. 'create_need', 'edit_qty_needed', 'approve_spend'
  detail text not null default '',  -- old and new values in plain words
  created_at timestamptz not null default now()
);

create index on campaigns(owner_id);
create index on needs(campaign_id);
create index on contributions(campaign_id);
create index on spends(campaign_id);
create index on audit_log(campaign_id, created_at desc);

-- Auto-create a profile when someone signs up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Organizer'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Row level security: organizers only touch their own data from the browser.
alter table profiles enable row level security;
alter table campaigns enable row level security;
alter table needs enable row level security;
alter table contributions enable row level security;
alter table spends enable row level security;
alter table audit_log enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own campaigns" on campaigns for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "own needs" on needs for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "own contributions" on contributions for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "own spends" on spends for all
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
create policy "own audit" on audit_log for select
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));
-- audit_log is written only by server code (service role), so no insert policy for browsers.
