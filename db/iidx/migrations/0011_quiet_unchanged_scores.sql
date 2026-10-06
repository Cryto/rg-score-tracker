-- Run in the Supabase SQL Editor, after 0010. Safe to re-run.
--
-- 1. A score write that doesn't improve the stored best (same EX score, lamp
--    and miss count after ratcheting, e.g. re-importing the same JSON
--    export) now keeps the chart's old updated_at, so it isn't shown as a
--    new update in the "last updated" sort.
-- 2. Adds IIDX 34 ZINRAI, which the catalog sheet's Release Version and
--    Playable In columns use.

create or replace function ratchet_score() returns trigger as $$
begin
  if new.miss_count < 0 then
    new.miss_count := null;
  end if;
  if TG_OP = 'UPDATE' and current_setting('app.recomputing_score', true) = 'on' then
    -- A recompute isn't a new play, so it doesn't move the score up the
    -- "most recent" sort either.
    new.updated_at := old.updated_at;
    return new;
  end if;
  if TG_OP = 'UPDATE' then
    perform private.log_score_attempt(new.chart_id, new.ex_score, new.clear_lamp, new.miss_count);
    new.ex_score := case
      when old.ex_score is null then new.ex_score
      when new.ex_score is null then old.ex_score
      else greatest(old.ex_score, new.ex_score)
    end;
    new.clear_lamp := case
      when old.clear_lamp is null then new.clear_lamp
      when new.clear_lamp is null then old.clear_lamp
      else greatest(old.clear_lamp, new.clear_lamp)
    end;
    new.miss_count := case
      when old.miss_count is null then new.miss_count
      when new.miss_count is null then old.miss_count
      else least(old.miss_count, new.miss_count)
    end;
    -- A submission that doesn't improve anything (e.g. re-importing the same
    -- export) keeps the old timestamp, so it isn't shown as a new update.
    if new.ex_score is not distinct from old.ex_score
      and new.clear_lamp is not distinct from old.clear_lamp
      and new.miss_count is not distinct from old.miss_count then
      new.updated_at := old.updated_at;
      return new;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

insert into versions (number, name, release_year, platform, sheet_name) values
  (34, '34 ZINRAI', null, 'arcade', 'ZINRAI')
on conflict (number) do nothing;
