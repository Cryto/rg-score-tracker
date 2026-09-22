-- Run in the Supabase SQL Editor if your database predates this migration.
-- New forks running the current db/schema.sql from scratch don't need this.
--
-- Logs every score submission as submitted (before ratcheting), as an audit
-- trail for a future score-over-time graph. Never read by the site's main
-- table: `scores` stays the field-by-field ratcheted best, exactly as before.
create table if not exists score_attempts (
  id bigserial primary key,
  chart_id integer not null references charts(id) on delete cascade,
  ex_score integer,
  clear_lamp clear_lamp,
  miss_count integer,
  submitted_at timestamptz not null default now()
);
create index if not exists score_attempts_chart_idx on score_attempts(chart_id, submitted_at desc);

alter table score_attempts enable row level security;
create policy "public read score_attempts" on score_attempts for select using (true);

-- No insert policy: the only way in is the `scores` triggers below (security
-- definer), and writes to `scores` are already owner-gated. The helper lives
-- in a `private` schema so Supabase doesn't expose it as a callable /rpc.
-- Skips empty submissions and exact repeats of the chart's latest attempt
-- (e.g. re-importing the same JSON export twice).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.log_score_attempt(
  p_chart_id integer, p_ex_score integer, p_clear_lamp clear_lamp, p_miss_count integer
) returns void as $$
declare
  last public.score_attempts%rowtype;
begin
  if p_ex_score is null and p_clear_lamp is null and p_miss_count is null then
    return;
  end if;
  select * into last from public.score_attempts
    where chart_id = p_chart_id order by submitted_at desc, id desc limit 1;
  if found
    and last.ex_score is not distinct from p_ex_score
    and last.clear_lamp is not distinct from p_clear_lamp
    and last.miss_count is not distinct from p_miss_count then
    return;
  end if;
  insert into public.score_attempts (chart_id, ex_score, clear_lamp, miss_count)
    values (p_chart_id, p_ex_score, p_clear_lamp, p_miss_count);
end;
$$ language plpgsql set search_path = public;
revoke all on function private.log_score_attempt from public, anon, authenticated;

-- Logging happens in two places so an upsert is logged exactly once:
--  * UPDATE (incl. upsert conflicts): inside ratchet_score, before NEW is
--    overwritten with the ratcheted values.
--  * INSERT: in an AFTER trigger, which only fires if the row was actually
--    inserted (a BEFORE INSERT trigger also fires on upserts that conflict).
create or replace function ratchet_score() returns trigger as $$
begin
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
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function log_inserted_score() returns trigger as $$
begin
  perform private.log_score_attempt(new.chart_id, new.ex_score, new.clear_lamp, new.miss_count);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists scores_log_insert on scores;
create trigger scores_log_insert
after insert on scores
for each row execute function log_inserted_score();
