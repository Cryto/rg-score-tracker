-- rg-score-tracker: initial schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query).
--
-- Before running the RLS policies at the bottom, create your own login:
--   Authentication > Users > Add user (email + password) in the Supabase dashboard.
-- Then copy that user's UUID and replace every <OWNER_UUID> placeholder below.

create type play_style as enum ('SP', 'DP');
create type chart_difficulty as enum ('B', 'N', 'H', 'A', 'L');

-- Declared low-to-high so comparisons (<, >, greatest()) reflect real progression.
create type clear_lamp as enum (
  'FAILED',
  'ASSIST_CLEAR',
  'EASY_CLEAR',
  'CLEAR',
  'HARD_CLEAR',
  'EX_HARD_CLEAR',
  'FULL_COMBO'
);

create table versions (
  id serial primary key,
  number integer not null unique,
  name text not null,
  release_year integer
);

create table songs (
  id serial primary key,
  title text not null,
  title_english text,
  title_sort text,
  genre text,
  artist text,
  bpm_min integer,
  bpm_max integer,
  debut_version_id integer references versions(id),
  -- id from an external catalog source (e.g. iidx-db), for idempotent re-imports.
  external_id text unique
);

create table charts (
  id serial primary key,
  song_id integer not null references songs(id) on delete cascade,
  play_style play_style not null,
  difficulty chart_difficulty not null,
  level integer not null check (level between 1 and 12),
  note_count integer,
  -- Optional free-text label, e.g. "Black Another" for charts that are
  -- Black Another rather than plain Leggendaria (difficulty stays 'L'
  -- either way -- this only affects the expanded row detail on the site).
  chart_label text,
  unique (song_id, play_style, difficulty)
);
create index charts_song_id_idx on charts(song_id);

create table scores (
  chart_id integer primary key references charts(id) on delete cascade,
  ex_score integer,
  clear_lamp clear_lamp,
  miss_count integer,
  updated_at timestamptz not null default now()
);

-- Every score submission as submitted (before ratcheting), as an audit trail
-- for a future score-over-time graph. Never read by the main table: `scores`
-- stays the field-by-field ratcheted best.
create table score_attempts (
  id bigserial primary key,
  chart_id integer not null references charts(id) on delete cascade,
  ex_score integer,
  clear_lamp clear_lamp,
  miss_count integer,
  submitted_at timestamptz not null default now()
);
create index score_attempts_chart_idx on score_attempts(chart_id, submitted_at desc);

-- score_attempts has no insert policy: the only way in is the `scores`
-- triggers below (security definer), and writes to `scores` are already
-- owner-gated. The helper lives in a `private` schema so Supabase doesn't
-- expose it as a callable /rpc. Skips empty submissions and exact repeats
-- of the chart's latest attempt (e.g. re-importing the same JSON export).
create schema private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.log_score_attempt(
  p_chart_id integer, p_ex_score integer, p_clear_lamp clear_lamp, p_miss_count integer
) returns void as $$
declare
  last public.score_attempts%rowtype;
begin
  if p_ex_score is null and p_clear_lamp is null and p_miss_count is null then
    return;
  end if;
  select * into last from public.score_attempts
    where chart_id = p_chart_id order by submitted_at desc, id desc limit 1;
  if found
    and last.ex_score is not distinct from p_ex_score
    and last.clear_lamp is not distinct from p_clear_lamp
    and last.miss_count is not distinct from p_miss_count then
    return;
  end if;
  insert into public.score_attempts (chart_id, ex_score, clear_lamp, miss_count)
    values (p_chart_id, p_ex_score, p_clear_lamp, p_miss_count);
end;
$$ language plpgsql set search_path = public;
revoke all on function private.log_score_attempt from public, anon, authenticated;

-- Each field only ever improves: uploading a new play never regresses your
-- EX score PB, lamp PB, or miss-count PB, even if the other fields are worse
-- on that particular play.
-- Attempts are logged in two places so an upsert is logged exactly once:
-- UPDATEs (incl. upsert conflicts) here, before NEW is ratcheted; INSERTs in
-- an AFTER trigger below, which only fires if the row was actually inserted
-- (BEFORE INSERT also fires on upserts that end up conflicting).
create or replace function ratchet_score() returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    perform private.log_score_attempt(new.chart_id, new.ex_score, new.clear_lamp, new.miss_count);
    new.ex_score := case
      when old.ex_score is null then new.ex_score
      when new.ex_score is null then old.ex_score
      else greatest(old.ex_score, new.ex_score)
    end;
    new.clear_lamp := case
      when old.clear_lamp is null then new.clear_lamp
      when new.clear_lamp is null then old.clear_lamp
      else greatest(old.clear_lamp, new.clear_lamp)
    end;
    new.miss_count := case
      when old.miss_count is null then new.miss_count
      when new.miss_count is null then old.miss_count
      else least(old.miss_count, new.miss_count)
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
  perform private.log_score_attempt(new.chart_id, new.ex_score, new.clear_lamp, new.miss_count);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create trigger scores_log_insert
after insert on scores
for each row execute function log_inserted_score();

-- Records when the song/chart catalog was last synced (written by the
-- import scripts), so the site can show a "DB last updated" timestamp
-- alongside scores.updated_at ("scores last updated").
create table catalog_syncs (
  id serial primary key,
  synced_at timestamptz not null default now()
);

-- Tracks which versions a chart was actually playable in (handles charts
-- removed from rotation and later reinstated), powering the "Playable in"
-- filter. Populated separately from schema setup.
create table chart_availability (
  chart_id integer not null references charts(id) on delete cascade,
  version_id integer not null references versions(id),
  primary key (chart_id, version_id)
);

-- Row Level Security: anyone can read, only the owner account can write.
alter table versions enable row level security;
alter table songs enable row level security;
alter table charts enable row level security;
alter table scores enable row level security;
alter table catalog_syncs enable row level security;
alter table chart_availability enable row level security;
alter table score_attempts enable row level security;

create policy "public read versions" on versions for select using (true);
create policy "public read songs" on songs for select using (true);
create policy "public read charts" on charts for select using (true);
create policy "public read scores" on scores for select using (true);
create policy "public read catalog_syncs" on catalog_syncs for select using (true);
create policy "public read chart_availability" on chart_availability for select using (true);
create policy "public read score_attempts" on score_attempts for select using (true);

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

-- Lets the owner insert/update catalog data from the browser (the
-- /settings/catalog-import page), the same way scores works above. This
-- widens the owner session's blast radius from "can edit scores" to "can
-- edit the whole catalog" -- see Key Decisions in the wiki.
create policy "owner write songs" on songs
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update songs" on songs
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);

create policy "owner write charts" on charts
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update charts" on charts
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);
