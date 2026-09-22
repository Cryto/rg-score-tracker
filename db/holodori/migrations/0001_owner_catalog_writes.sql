-- Run in the Holodori project's SQL Editor if your database predates this
-- migration. New forks running the current db/holodori/schema.sql don't need it.
--
-- Lets the owner add/edit songs and chart levels from the browser (the
-- /settings/holodori-song page), mirroring IIDX's catalog-import policies.
-- This widens the owner session from "can edit scores" to "can edit the
-- catalog". Replace <OWNER_UUID> in the SQL Editor only, never in the repo.
create policy "owner write songs" on songs
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update songs" on songs
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);

create policy "owner write charts" on charts
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner update charts" on charts
  for update using (auth.uid() = '<OWNER_UUID>'::uuid);

-- So catalog edits made in the browser update "DB last updated".
create policy "owner write catalog_syncs" on catalog_syncs
  for insert with check (auth.uid() = '<OWNER_UUID>'::uuid);
