-- rg-score-tracker: hololive Dreams ("Holodori") schema.
-- Run this in the SQL Editor of the *Holodori* Supabase project -- each game
-- lives in its own project, separate from IIDX's db/schema.sql.
--
-- Before running the RLS policies at the bottom, create the owner login in
-- this project too (Authentication > Users > Add user, same email/password as
-- the IIDX project so /login signs in to both), then replace every
-- <OWNER_UUID> placeholder below with that user's UUID -- in the SQL Editor
-- only, never in the repo.

create type difficulty as enum ('EASY', 'NORMAL', 'HARD', 'EXPERT');

-- Declared low-to-high so greatest() keeps the better clear.
create type clear_lamp as enum ('CLEAR', 'FULL_COMBO', 'ALL_PERFECT');

create table songs (
  id serial primary key,
  -- Title as shown in-game / on the official JP site. Also the identity used
  -- by the import script, so it must stay unique.
  title_jp text not null unique,
  title_en text,
  artist_jp text,
  artist_en text,
  lyrics_jp text,
  lyrics_en text,
  music_jp text,
  music_en text,
  arrangement_jp text,
  arrangement_en text,
  -- 'original' / 'cover' per the official music page; null for songs that
  -- only come from the level sheet (not listed on the official site).
  category text check (category in ('original', 'cover')),
  -- Position on the official music page (null for sheet-only songs).
  official_order integer,
  -- Jackets are linked on the official CDN, not self-hosted.
  jacket_asset_id text,
  jacket_url text,
  -- Individual members related to the song, separate from the credit above
  -- (e.g. a FUWAMOCO song lists Fuwawa and Mococo). Powers the Member filter
  -- alongside individual names in the credit; set from /settings/holodori-song.
  members text[]
);

create table charts (
  id serial primary key,
  song_id integer not null references songs(id) on delete cascade,
  difficulty difficulty not null,
  level integer check (level between 1 and 99),
  unique (song_id, difficulty)
);
create index charts_song_id_idx on charts(song_id);

-- One row per chart: your personal best. Scores have no fixed maximum; the
-- grade (D/C/B/A/S/S+N) is derived from score at display time, not stored.
create table scores (
  chart_id integer primary key references charts(id) on delete cascade,
  score integer check (score >= 0),
  clear_lamp clear_lamp,
  updated_at timestamptz not null default now()
);

-- Every submission as submitted (before ratcheting), for a future
-- score-over-time graph. Never read for the displayed best.
create table score_attempts (
  id bigserial primary key,
  chart_id integer not null references charts(id) on delete cascade,
  score integer,
  clear_lamp clear_lamp,
  submitted_at timestamptz not null default now()
);
create index score_attempts_chart_idx on score_attempts(chart_id, submitted_at desc);

-- Written by the catalog import script; powers "DB last updated".
create table catalog_syncs (
  id serial primary key,
  synced_at timestamptz not null default now()
);

-- score_attempts has no insert policy: the only way in is the `scores`
-- triggers below (security definer), and writes to `scores` are owner-gated.
-- The helper lives in a `private` schema so Supabase doesn't expose it as a
-- callable /rpc. Skips empty submissions and exact repeats of the chart's
-- latest attempt (e.g. re-importing the same data).
create schema private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.log_score_attempt(
  p_chart_id integer, p_score integer, p_clear_lamp clear_lamp
) returns void as $$
declare
  last public.score_attempts%rowtype;
begin
  if p_score is null and p_clear_lamp is null then
    return;
  end if;
  select * into last from public.score_attempts
    where chart_id = p_chart_id order by submitted_at desc, id desc limit 1;
  if found
    and last.score is not distinct from p_score
    and last.clear_lamp is not distinct from p_clear_lamp then
    return;
  end if;
  insert into public.score_attempts (chart_id, score, clear_lamp)
    values (p_chart_id, p_score, p_clear_lamp);
end;
$$ language plpgsql set search_path = public;
revoke all on function private.log_score_attempt from public, anon, authenticated;

-- Score and clear lamp each only ever improve, independently: a new play
-- never regresses one to accommodate the other.
-- Attempts are logged in two places so an upsert is logged exactly once:
-- UPDATEs (incl. upsert conflicts) here, before NEW is ratcheted; INSERTs in
-- an AFTER trigger below, which only fires if the row was actually inserted
-- (BEFORE INSERT also fires on upserts that end up conflicting).
create or replace function ratchet_score() returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    perform private.log_score_attempt(new.chart_id, new.score, new.clear_lamp);
    new.score := case
      when old.score is null then new.score
      when new.score is null then old.score
      else greatest(old.score, new.score)
    end;
    new.clear_lamp := case
      when old.clear_lamp is null then new.clear_lamp
      when new.clear_lamp is null then old.clear_lamp
      else greatest(old.clear_lamp, new.clear_lamp)
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger scores_ratchet
before insert or update on scores
for each row execute function ratchet_score();

create or replace function log_inserted_score() returns trigger as $$
begin
  perform private.log_score_attempt(new.chart_id, new.score, new.clear_lamp);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create trigger scores_log_insert
after insert on scores
for each row execute function log_inserted_score();

-- Row Level Security: anyone can read, only the owner account can write.
-- The import script writes the catalog with the service-role key (bypassing
-- RLS); the owner policies on songs/charts let the owner also add songs and
-- edit levels from the browser (/settings/holodori-song).
alter table songs enable row level security;
alter table charts enable row level security;
alter table scores enable row level security;
alter table score_attempts enable row level security;
alter table catalog_syncs enable row level security;

create policy "public read songs" on songs for select using (true);
create policy "public read charts" on charts for select using (true);
create policy "public read scores" on scores for select using (true);
create policy "public read score_attempts" on score_attempts for select using (true);
create policy "public read catalog_syncs" on catalog_syncs for select using (true);

create policy "owner write scores" on scores
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update scores" on scores
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);
-- Removing a score or a single attempt (add/update score page). No delete
-- trigger: removing a score leaves its attempts, and vice versa.
create policy "owner delete scores" on scores
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner delete score_attempts" on score_attempts
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);

create policy "owner write songs" on songs
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update songs" on songs
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);

create policy "owner write charts" on charts
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update charts" on charts
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);

create policy "owner write catalog_syncs" on catalog_syncs
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
