-- Run in the Hololive Dreams project's Supabase SQL Editor if your database
-- predates this migration. New forks running the current
-- db/holodori/schema.sql from scratch don't need this.
--
-- Deleting an attempt now recomputes the chart's best from the attempts
-- that remain, each field separately: highest score, best clear. Deleting a
-- chart's last attempt removes its score. (Before this, deleting an attempt
-- never changed the score.)

-- Recomputes one chart's score from its attempts. Private (not /rpc
-- callable); runs from the attempt-delete trigger below.
create or replace function private.recompute_score(p_chart_id integer) returns void as $$
declare
  best record;
begin
  select count(*) as n, max(score) as score, max(clear_lamp) as clear_lamp
    into best from public.score_attempts where chart_id = p_chart_id;
  if best.n = 0 then
    delete from public.scores where chart_id = p_chart_id;
    return;
  end if;
  -- Tells ratchet_score to store these values as-is: no ratcheting against
  -- the old (possibly mistyped) best, and no new attempt logged.
  perform set_config('app.recomputing_score', 'on', true);
  update public.scores
    set score = best.score, clear_lamp = best.clear_lamp
    where chart_id = p_chart_id;
  perform set_config('app.recomputing_score', 'off', true);
end;
$$ language plpgsql set search_path = public;
revoke all on function private.recompute_score from public, anon, authenticated;

create or replace function ratchet_score() returns trigger as $$
begin
  if TG_OP = 'UPDATE' and current_setting('app.recomputing_score', true) = 'on' then
    -- A recompute isn't a new play, so it doesn't move the score up the
    -- "most recent" sort either.
    new.updated_at := old.updated_at;
    return new;
  end if;
  if TG_OP = 'UPDATE' then
    perform private.log_score_attempt(new.chart_id, new.score, new.clear_lamp);
    new.score := case
      when old.score is null then new.score
      when new.score is null then old.score
      else greatest(old.score, new.score)
    end;
    new.clear_lamp := case
      when old.clear_lamp is null then new.clear_lamp
      when new.clear_lamp is null then old.clear_lamp
      else greatest(old.clear_lamp, new.clear_lamp)
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function recompute_score_after_attempt_delete() returns trigger as $$
begin
  perform private.recompute_score(old.chart_id);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists score_attempts_recompute on score_attempts;
create trigger score_attempts_recompute
after delete on score_attempts
for each row execute function recompute_score_after_attempt_delete();

-- One-time: bring every score that has attempts in line with them (applies
-- any attempt deleted before this migration). Scores with no attempts are
-- left alone.
select private.recompute_score(chart_id) from (select distinct chart_id from score_attempts) c;
