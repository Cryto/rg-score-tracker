-- Run in the Supabase SQL Editor before the first run of
-- db/iidx/import/import-sheet.mjs. New forks running the current
-- db/iidx/schema.sql from scratch don't need this.
--
-- The IIDX catalog now comes from the "Infinitas DB" Google Sheet (tab
-- Master) instead of iidx-db. This only adds things, so the site keeps
-- working before and after it runs.

-- Song columns the sheet carries that had no home before. `extra` holds any
-- sheet column the importer doesn't know yet, keyed by its header.
alter table songs add column if not exists composition text;
alter table songs add column if not exists arrangement text;
alter table songs add column if not exists production text;
alter table songs add column if not exists lyrics text;
alter table songs add column if not exists vocals text;
alter table songs add column if not exists bpm_text text;
alter table songs add column if not exists length_text text;
alter table songs add column if not exists length_seconds integer;
alter table songs add column if not exists remywiki_url text;
alter table songs add column if not exists notes text;
alter table songs add column if not exists extra jsonb not null default '{}'::jsonb;

-- `platform` separates arcade releases from CS, INFINITAS and ULTIMATE
-- MOBILE; `sheet_name` is how the sheet's Release Version and Playable In
-- columns spell each version.
alter table versions add column if not exists platform text not null default 'arcade';
alter table versions add column if not exists sheet_name text unique;

update versions set sheet_name = case number
  when 0 then 'substream'
  when 1 then '1st'
  when 2 then '2nd'
  when 3 then '3rd'
  when 4 then '4th'
  when 5 then '5th'
  when 6 then '6th'
  when 7 then '7th'
  when 8 then '8th'
  when 9 then '9th'
  when 10 then '10th'
  else regexp_replace(name, '^[0-9]+ (IIDX )?', '')
end
where sheet_name is null and number between 0 and 99;

-- CS releases are numbered 100 + the arcade version they follow, INFINITAS
-- 200 and ULTIMATE MOBILE 300, so they sort after the arcade versions.
-- Release years are left blank rather than guessed.
insert into versions (number, name, release_year, platform, sheet_name) values
  (103, '3rd style CS', null, 'cs', '3rd CS'),
  (104, '4th style CS', null, 'cs', '4th CS'),
  (105, '5th style CS', null, 'cs', '5th CS'),
  (106, '6th style CS', null, 'cs', '6th CS'),
  (107, '7th style CS', null, 'cs', '7th CS'),
  (108, '8th style CS', null, 'cs', '8th CS'),
  (109, '9th style CS', null, 'cs', '9th CS'),
  (110, '10th style CS', null, 'cs', '10th CS'),
  (111, '11 IIDX RED CS', null, 'cs', 'RED CS'),
  (112, '12 HAPPY SKY CS', null, 'cs', 'HAPPY SKY CS'),
  (113, '13 DistorteD CS', null, 'cs', 'DistorteD CS'),
  (114, '14 GOLD CS', null, 'cs', 'GOLD CS'),
  (115, '15 DJ TROOPERS CS', null, 'cs', 'DJ TROOPERS CS'),
  (116, '16 EMPRESS CS', null, 'cs', 'EMPRESS CS'),
  (200, 'INFINITAS', null, 'infinitas', 'INFINITAS'),
  (300, 'ULTIMATE MOBILE', null, 'mobile', 'ULTIMATE MOBILE')
on conflict (number) do nothing;

-- Lets the site tell a sheet sync from an older iidx-db one.
alter table catalog_syncs add column if not exists source text;
