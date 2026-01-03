create table if not exists picks (
  id integer primary key,
  picked_at timestamptz not null default now()
);

alter table picks enable row level security;

drop policy if exists "Public read picks" on picks;
drop policy if exists "Public insert picks" on picks;
drop policy if exists "Public delete picks" on picks;

create policy "Public read picks"
  on picks
  for select
  using (true);

create policy "Public insert picks"
  on picks
  for insert
  with check (true);

create policy "Public delete picks"
  on picks
  for delete
  using (true);
