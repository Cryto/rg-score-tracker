-- Run in the Supabase SQL Editor (with your real UUID substituted for
-- <OWNER_UUID> -- never commit that). Safe to re-run.
--
-- A song can be known by more than one score-export ID: INFINITAS originals
-- that later went to arcade have their 80xxx INFINITAS ID and an arcade ID
-- (GRAVITON is 80011 and 29002). songs.external_id stays the song's main
-- ID; song_external_ids holds the others, and the JSON score import matches
-- either.
create table if not exists song_external_ids (
  external_id text primary key,
  song_id integer not null references songs(id) on delete cascade
);
create index if not exists song_external_ids_song_id on song_external_ids (song_id);

-- An ID can only point at one song, whichever table holds it.
create or replace function check_song_external_id() returns trigger as $$
begin
  if TG_TABLE_NAME = 'song_external_ids' then
    if exists (select 1 from songs where external_id = new.external_id) then
      raise exception 'external id % is already the main ID of another song', new.external_id;
    end if;
  elsif new.external_id is not null
    and exists (select 1 from song_external_ids where external_id = new.external_id and song_id <> new.id) then
    raise exception 'external id % is already an extra ID of another song', new.external_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists check_song_external_id on song_external_ids;
create trigger check_song_external_id before insert or update on song_external_ids
  for each row execute function check_song_external_id();
drop trigger if exists check_song_external_id on songs;
create trigger check_song_external_id before insert or update of external_id on songs
  for each row execute function check_song_external_id();

alter table song_external_ids enable row level security;
drop policy if exists "public read song_external_ids" on song_external_ids;
create policy "public read song_external_ids" on song_external_ids for select using (true);
drop policy if exists "owner write song_external_ids" on song_external_ids;
create policy "owner write song_external_ids" on song_external_ids
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
drop policy if exists "owner delete song_external_ids" on song_external_ids;
create policy "owner delete song_external_ids" on song_external_ids
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);

-- Arcade IDs of INFINITAS originals seen in score exports so far.
insert into song_external_ids (external_id, song_id)
select v.extra, s.id
from (values ('80002','28117'), ('80011','29002'), ('80006','29068'), ('80009','29096')) as v(main, extra)
join songs s on s.external_id = v.main
on conflict (external_id) do nothing;
