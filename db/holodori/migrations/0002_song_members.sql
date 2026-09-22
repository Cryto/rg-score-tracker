-- Run in the Holodori project's SQL Editor if your database predates this
-- migration. New forks running the current db/holodori/schema.sql don't need it.
--
-- Individual members related to a song, kept separate from the credited
-- singer/unit (artist_en/artist_jp) so a song credited to a group (e.g.
-- FUWAMOCO) can also count for each member in the Member filter. Edited on
-- /settings/holodori-song; the catalog import script never touches it.
alter table songs add column if not exists members text[];
