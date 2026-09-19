-- Run in the Supabase SQL Editor if your database predates this migration.
-- New forks running the current db/schema.sql from scratch don't need this.
--
-- Tracks when the song/chart catalog was last synced, so the site can show
-- a "DB last updated" timestamp alongside the existing "scores last updated"
-- (scores.updated_at, already maintained by the ratchet_score() trigger).
create table if not exists catalog_syncs (
  id serial primary key,
  synced_at timestamptz not null default now()
);

alter table catalog_syncs enable row level security;

create policy "public read catalog_syncs" on catalog_syncs for select using (true);
