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

### Importing from iidx-db

[`db/import/import-iidx-db.mjs`](db/import/import-iidx-db.mjs) imports the
song/chart catalog from [vanHavel/iidx-db](https://github.com/vanHavel/iidx-db)
(MIT licensed), whose data is extracted directly from IIDX Infinitas via
[Reflux](https://github.com/olji/Reflux) — i.e. sourced from the game itself,
not scraped from a third-party site. Coverage is whatever's currently in
Infinitas' rotation, not the full arcade back catalog; `debut_version_id` is
left unset since Infinitas' internal folder grouping doesn't map cleanly to
arcade version numbers yet.

```sh
curl -L -o db/import/songs.tsv https://media.githubusercontent.com/media/vanHavel/iidx-db/master/raw_data/songs.tsv
node --env-file=.env db/import/import-iidx-db.mjs db/import/songs.tsv
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in your `.env` (never commit this key,
never expose it to the browser — it bypasses RLS entirely). The script is
idempotent: re-running it after the source data updates just upserts changes,
matched by iidx-db's own song ID (`songs.external_id`).

### Other sources

To import from anywhere else, write a script that maps your source into the
same shape the importer above produces — one row per song plus a list of
`{ playStyle: 'SP' | 'DP', difficulty: 'B'|'N'|'H'|'A'|'L', level, noteCount }`
per chart — and upserts via the Supabase JS client with the service role key.

## Score entry

- **Manual**: `/settings/new` — search a song/chart, enter EX score / lamp / miss count.
- **Bulk CSV**: `/settings/import` — paste a CSV (see column format on that page),
  preview matches against the catalog, then import.

These routes aren't in the main site nav — the floating settings button
(bottom-left) links to `/login`, which redirects to `/settings` (a hub linking
to both pages above) once you're signed in, or skips straight there if you're
already logged in. They aren't access-controlled beyond that — the Postgres
RLS policies on `scores` remain the only write guard.

## Branding

By default the app is unbranded — just its own dark theme, no references to
the original author's site. Setting `PUBLIC_SHOW_CRYTO_NAV=true` in `.env`
adds a cryto.dev-branded header bar (`src/components/CrytoNav.astro`) above
the app's own nav; this only makes sense for the canonical deployment at
[rg.cryto.dev](https://rg.cryto.dev). Leave it unset on a fork, or delete
`CrytoNav.astro` entirely if you don't need the toggle.
