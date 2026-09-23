-- Run in the Holodori project's SQL Editor if your database predates this migration
-- (with your real UUID substituted for <OWNER_UUID> -- never commit that).
-- New forks running the current db/holodori/schema.sql from scratch still need to
-- run these statements manually, same as the other owner policies.
--
-- Lets the owner remove a score and delete individual attempts from the
-- history on the add/update score page, e.g. to correct a mistyped score:
-- scores only ever improve, so a too-high typo can't be overwritten, only
-- deleted. There is no delete trigger, so removing a score leaves its
-- attempts in place, and deleting an attempt never changes the score.
create policy "owner delete scores" on scores
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);
create policy "owner delete score_attempts" on score_attempts
  for delete using (auth.uid() = '<OWNER_UUID>'::uuid);
