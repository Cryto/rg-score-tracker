-- Run in the Supabase SQL Editor if your database predates this migration.
-- New forks running the current db/schema.sql from scratch don't need this.
--
-- Optional free-text label for a chart, e.g. "Black Another" for the charts
-- that are Black Another rather than plain Leggendaria. Difficulty stays 'L'
-- either way (Black Another and Leggendaria share the same filter/enum
-- value) -- this column only affects the expanded row detail on the site.
-- Left null for every chart; there's no automated source for this data, so
-- it's backfilled by hand (or later via the catalog import tool).
alter table charts add column if not exists chart_label text;
