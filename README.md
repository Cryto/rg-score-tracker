# rg-score-tracker

A personal rhythm-game score tracker, starting with beatmania IIDX. Built with
[Astro](https://astro.build) (fully static) and [Supabase](https://supabase.com)
(Postgres + auth). Designed to be forked — plug in your own Supabase project and
song data.

## How it works

- **Song/chart catalog** (`versions`, `songs`, `charts`) is public read-only data:
  titles, levels, note counts, etc.
- **Scores** (`scores`) is one row per chart, holding your personal best. Each
  field (EX score, clear lamp, miss count) only ever improves when you submit a
  new play — see the `ratchet_score()` trigger in [`db/schema.sql`](db/schema.sql).
- Reads are public to everyone; writes require logging in as the site owner
  (enforced by Postgres Row Level Security, not by hiding an API key).

## Setup

1. Create a [Supabase](https://supabase.com) project (free tier is fine).
2. Copy `.env.example` to `.env` and fill in your project's URL and
   anon/publishable key (**Project Settings > API**).
3. In the Supabase SQL Editor, run [`db/schema.sql`](db/schema.sql).
4. In **Authentication > Users**, add yourself as a user (email + password).
   Copy that user's UUID and replace the `<OWNER_UUID>` placeholders in
   `db/schema.sql`'s policies, then re-run just those `create policy` statements.
5. `npm install`
6. Populate the song catalog — see "Song data" below.
7. `npm run dev`

## Song data

The `songs`/`charts` tables are populated separately from the app itself, since
`songs`/`charts` have no public write policy (only `service_role` can write to
them, bypassing RLS). This is intentional: catalog data should be curated, not
publicly writable.

To import data, write a script that maps your source (CSV, scraped JSON,
whatever) into the shape:

```ts
{ title, artist, genre, bpm_min, bpm_max, versionNumber,
  charts: [{ playStyle: 'SP' | 'DP', difficulty: 'B'|'N'|'H'|'A'|'L', level, noteCount }] }
```

and inserts it using the Supabase JS client with the `SUPABASE_SERVICE_ROLE_KEY`
from your `.env` (never commit this key, never expose it to the browser — it
bypasses RLS entirely). No specific source is wired up yet; this repo doesn't
ship anyone's personal score data or a fixed importer format on purpose, so
forks can plug in whatever source they prefer.

## Score entry

- **Manual**: `/scores/new` — search a song/chart, enter EX score / lamp / miss count.
- **Bulk CSV**: `/scores/import` — paste a CSV (see column format on that page),
  preview matches against the catalog, then import.

Both require being logged in at `/login`.
