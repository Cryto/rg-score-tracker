-- Run in the Supabase SQL Editor if your database predates this migration.
-- New forks running the current db/schema.sql from scratch don't need this.
--
-- Tracks which versions a chart was actually playable in (handles charts
-- removed from rotation and later reinstated), powering the "Playable in"
-- filter on the site. Ships empty -- populating this is a separate
-- research/data-entry effort, not part of this migration.
create table if not exists chart_availability (
  chart_id integer not null references charts(id) on delete cascade,
  version_id integer not null references versions(id),
  primary key (chart_id, version_id)
);

alter table chart_availability enable row level security;

create policy "public read chart_availability" on chart_availability for select using (true);
