-- Run in Supabase SQL Editor if your database was created before this migration
-- (i.e. you already ran the original db/schema.sql). New forks running the
-- current schema.sql from scratch don't need this.
alter table songs add column if not exists title_english text;
alter table songs add column if not exists external_id text unique;
