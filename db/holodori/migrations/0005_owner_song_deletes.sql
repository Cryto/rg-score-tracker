-- Run in the Hololive Dreams project's Supabase SQL Editor if your database
-- predates this migration (with your real UUID substituted for <OWNER_UUID>
-- -- never commit that). New forks running the current db/holodori/schema.sql
-- from scratch still need to run these statements manually, same as the
-- other owner policies.
--
-- Lets the owner delete songs and charts from the browser: Undo after adding
-- a song on /settings/holodori/song, and Remove on /settings/holodori/songs.
-- Without these, RLS silently deletes nothing, so Undo looked like it worked
-- but left the song in place. Deleting a song cascades to its charts, their
-- scores and their score attempts.
create policy "owner delete songs" on songs
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner delete charts" on charts
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);
