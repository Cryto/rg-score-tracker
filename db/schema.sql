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

-- Each field only ever improves: uploading a new play never regresses your
-- EX score PB, lamp PB, or miss-count PB, even if the other fields are worse
-- on that particular play.
create or replace function ratchet_score() returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
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
$$ language plpgsql;

create trigger scores_ratchet
before insert or update on scores
for each row execute function ratchet_score();

-- Row Level Security: anyone can read, only the owner account can write.
alter table versions enable row level security;
alter table songs enable row level security;
alter table charts enable row level security;
alter table scores enable row level security;

create policy "public read versions" on versions for select using (true);
create policy "public read songs" on songs for select using (true);
create policy "public read charts" on charts for select using (true);
create policy "public read scores" on scores for select using (true);

create policy "owner write scores" on scores
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update scores" on scores
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);
