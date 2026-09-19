-- Run in the Supabase SQL Editor if your database predates this migration
-- (with your real UUID substituted for <OWNER_UUID> -- never commit that).
-- New forks running the current db/schema.sql from scratch still need to
-- run these two statements manually, same as the existing scores policies.
--
-- Lets the owner insert/update songs and charts from the browser (the new
-- /settings/catalog-import page), the same way scores already works. This
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
