<div align="center">

# 🎵 rg-score-tracker

**A personal, self-hosted score tracker for rhythm games.**

Log your personal bests, see every past attempt, and share a read-only page of your scores.

[![Live site](https://img.shields.io/badge/live-rg.cryto.dev-8b5cf6?style=flat-square)](https://rg.cryto.dev)
[![Astro](https://img.shields.io/badge/Astro-static-ff5d01?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Netlify](https://img.shields.io/badge/deploys%20on-Netlify-00c7b7?style=flat-square&logo=netlify&logoColor=white)](https://www.netlify.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[Features](#-features) ·
[Games](#-games) ·
[Quick start](#-quick-start) ·
[Configuration](#-configuration) ·
[Song data](#-song-data) ·
[Forking](#-forking) ·
[Project layout](#-project-layout)

</div>

---

## ✨ Features

- **Personal bests that only go up.** Each chart keeps one best score. Every
  field (score, clear lamp, miss count) is improved separately by a Postgres
  trigger, so a new play never overwrites a better one.
- **Full play history.** Every submission is kept as an attempt. Deleting a
  mistyped attempt recomputes the best from the attempts that remain.
- **Public to read, private to write.** Anyone can browse your scores; only
  you can change them. That's enforced by Postgres Row Level Security, not by
  hiding an API key.
- **Several ways to enter scores.** Manual entry, bulk CSV paste, and (for
  IIDX) a native JSON score export.
- **Pick your games.** Each game is a self-contained add-on with its own
  Supabase project. Run all of them, or fork and keep just one.
- **Fully static.** Astro builds plain HTML/JS; the browser talks to Supabase
  directly. No server to run.

## 🎮 Games

| Game | Status | Score entry | Catalog source |
| --- | --- | --- | --- |
| **beatmania IIDX** | ✅ Live | Manual, CSV, JSON export | [vanHavel/iidx-db](https://github.com/vanHavel/iidx-db) (from Infinitas) |
| **Hololive Dreams** | ✅ Live | Manual | Curated in the original site's database, exported to [`catalog.json`](db/holodori/catalog.json) |
| **DJMAX Respect V** | 🚧 Coming soon | — | — |

## 🚀 Quick start

**Requirements:** Node.js 22.12+ and a free [Supabase](https://supabase.com)
account.

```sh
git clone https://github.com/Cryto/rg-score-tracker.git
cd rg-score-tracker
npm install
cp .env.example .env
```

Then set up a database for each game you want (you can skip any of them):

<details>
<summary><b>beatmania IIDX</b></summary>

1. Create a Supabase project for IIDX.
2. In **Authentication › Users**, add yourself as a user (email + password)
   and copy its UUID.
3. Open [`db/iidx/schema.sql`](db/iidx/schema.sql) in the **SQL Editor**,
   replace every `<OWNER_UUID>` with your UUID, and run it.
   Do the replacement in the SQL Editor only, never in the repo.
4. Put the project's URL and anon/publishable key (**Project Settings › API**)
   in `.env` as `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
5. Load the song catalog (see [Song data](#-song-data)).

</details>

<details>
<summary><b>Hololive Dreams</b></summary>

1. Create a **separate** Supabase project for Hololive Dreams.
2. Add the same owner login as your other projects (same email and password),
   so `/login` signs you in to every game at once. Copy its UUID.
3. Open [`db/holodori/schema.sql`](db/holodori/schema.sql) in the
   **SQL Editor**, replace every `<OWNER_UUID>` with your UUID, and run it.
4. Put the URL and anon key in `.env` as `PUBLIC_SUPABASE_URL_HOLODORI` and
   `PUBLIC_SUPABASE_ANON_KEY_HOLODORI`.
5. Load the song catalog (see [Song data](#-song-data)).

</details>

Start the dev server:

```sh
npm run dev
```

> [!NOTE]
> If your database was created from an older schema, apply the files in
> `db/<id>/migrations/` in order. A fresh install from the current
> `schema.sql` doesn't need them.

## ⚙️ Configuration

All settings live in `.env` (copy it from [`.env.example`](.env.example)).
Astro only exposes variables prefixed with `PUBLIC_` to the browser.

| Variable | Used for | Required |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | IIDX project URL | To enable IIDX |
| `PUBLIC_SUPABASE_ANON_KEY` | IIDX anon/publishable key | To enable IIDX |
| `PUBLIC_SUPABASE_URL_HOLODORI` | Hololive Dreams project URL | To enable Hololive Dreams |
| `PUBLIC_SUPABASE_ANON_KEY_HOLODORI` | Hololive Dreams anon/publishable key | To enable Hololive Dreams |
| `SUPABASE_SERVICE_ROLE_KEY` | IIDX catalog import scripts | Locally, for imports only |
| `SUPABASE_SERVICE_ROLE_KEY_HOLODORI` | Hololive Dreams catalog import script | Locally, for imports only |
| `PUBLIC_SHOW_CRYTO_NAV` | The original author's cryto.dev header bar | ❌ Leave unset on forks |

A game whose URL and key aren't set is simply turned off: it disappears from
the nav, the home page, login and settings.

> [!CAUTION]
> Service role keys bypass Row Level Security entirely. Never commit them,
> never put them in Netlify, and never give them a `PUBLIC_` prefix.

## 📝 Entering scores

The floating settings button (bottom-left) goes to `/login`, which forwards
you to `/settings` once you're signed in. The settings hub lists each enabled
game's tools:

| Game | Page | What it does |
| --- | --- | --- |
| IIDX | `/settings/iidx/new` | Search a song/chart, enter EX score, lamp and miss count |
| IIDX | `/settings/iidx/import` | Paste a CSV of scores matched by title, preview, then import |
| IIDX | `/settings/iidx/import-json` | Upload a native score export, matched exactly by song ID |
| Hololive Dreams | `/settings/holodori/new` | Pick a song and difficulty, enter score and clear |
| Hololive Dreams | `/settings/holodori/song` | Add or edit a song, its levels, song type and members |
| Hololive Dreams | `/settings/holodori/songs` | List every song, remove songs (with their scores), and find and fix songs missing a song type, member or jacket |

These pages aren't access-controlled themselves; the RLS policies in the
database are the only write guard, and they only accept the owner's UUID.

## 📚 Song data

Songs and charts are curated data: the public can read them, but only the
owner (through the settings pages) or the `service_role` key (through the
scripts below) can write them.

### beatmania IIDX

The catalog's source of truth is the "Infinitas DB" Google Sheet (tab
Master, one row per song and play style).
[`db/iidx/import/import-sheet.mjs`](db/iidx/import/import-sheet.mjs) imports
a CSV download of that tab. Run
[`0010_sheet_catalog.sql`](db/iidx/migrations/0010_sheet_catalog.sql) once
first.

```sh
node --env-file=.env db/iidx/import/import-sheet.mjs master.csv --dry-run
node --env-file=.env db/iidx/import/import-sheet.mjs master.csv
```

- Songs keep their id through the sheet's "Supabase ID" column. Rows with a
  blank ID are inserted as new songs, and their new ids are written to
  `new-song-ids.csv` to paste back into the sheet.
- Charts are matched on song, style and difficulty, so their ids (and the
  scores on them) survive re-runs. BA columns become difficulty L with the
  label "Black Another".
- Sheet columns the script doesn't know land in `songs.extra`.
- Songs and charts that aren't in the sheet are only listed, unless you pass
  `--delete-missing`, which deletes them along with their scores.

The older importer below loaded the catalog from iidx-db. Don't re-run it
after switching to the sheet: it would overwrite sheet data.

[`db/iidx/import/import-iidx-db.mjs`](db/iidx/import/import-iidx-db.mjs)
imports the catalog from [vanHavel/iidx-db](https://github.com/vanHavel/iidx-db)
(MIT), whose data is extracted from IIDX Infinitas via
[Reflux](https://github.com/olji/Reflux), so it comes from the game itself
rather than a scraped fan site.

```sh
curl -L -o db/iidx/import/songs.tsv https://media.githubusercontent.com/media/vanHavel/iidx-db/master/raw_data/songs.tsv
node --env-file=.env db/iidx/import/import-iidx-db.mjs db/iidx/import/songs.tsv
```

- Re-running is safe: rows are upserted by iidx-db's own song ID
  (`songs.external_id`).
- Coverage is whatever is in Infinitas' current rotation, not the full arcade
  back catalog, and `debut_version_id` is left unset.
- [`backfill-romaji.mjs`](db/iidx/import/backfill-romaji.mjs) fills in missing
  English titles with automatic romaji. Treat its output as a starting point
  and spot-check it.

**Other sources:** write a script that produces one row per song plus a list
of `{ playStyle: 'SP' | 'DP', difficulty: 'B'|'N'|'H'|'A'|'L', level, noteCount }`
per chart, and upsert it with the Supabase JS client using the service role key.

### Hololive Dreams

The catalog lives in the original site's database, where songs are added and
edited from `/settings/holodori/song`. [`catalog.json`](db/holodori/catalog.json)
is a committed snapshot of it: every song with its credits, song type,
members, jacket and chart levels. It's exported from the `songs` and `charts`
tables only, never scores.

**Loading it into your project** (a fork, or a fresh database) needs the
service role key, since it writes songs and charts:

```sh
node --env-file=.env db/holodori/import-catalog.mjs --dry-run   # preview
node --env-file=.env db/holodori/import-catalog.mjs             # load into Supabase
```

The import is idempotent and never deletes songs, so re-run it to pick up a
newer `catalog.json`. Values you've edited in the browser (English titles,
song type, jacket, members, levels) are kept unless you pass `--force`.

**Refreshing the snapshot** (original site only) is done by hand after
editing songs, then committing the new file. It only reads public tables, so
the anon key in `.env` is enough:

```sh
node --env-file=.env db/holodori/export-catalog.mjs
```

## 🍴 Forking

The site is built to be forked, including for just one game.

1. **Keep only the games you want.** Leave the other games' env vars unset, or
   delete their `src/games/<id>/` and `db/<id>/` folders. Nothing else needs
   editing; the shared site finds games automatically.
2. **Leave `PUBLIC_SHOW_CRYTO_NAV` unset.** By default the app is unbranded.
   That flag adds the original author's cryto.dev header bar
   ([`CrytoNav.astro`](src/components/CrytoNav.astro)) and only makes sense
   on [rg.cryto.dev](https://rg.cryto.dev).
3. **Trim [`public/_redirects`](public/_redirects).** The `iidx.cryto.dev`
   rules are for the original deployment's old domain.
4. **Deploy on Netlify.** Build command `npm run build`, publish directory
   `dist`, and add your `PUBLIC_…` variables under **Site configuration ›
   Environment variables**. They're read at build time, so redeploy after
   changing them.

### Adding a game

Start from [`src/games/djmax/`](src/games/djmax), the smallest example (a
coming-soon placeholder with one page):

1. Fill in `game.ts`: name, route, home-card picture, Supabase env vars and
   settings links (see [`src/games/types.ts`](src/games/types.ts)).
2. Add pages under `src/games/<id>/pages/`, laid out like `src/pages/`.
3. Add the schema, migrations and import scripts under `db/<id>/`.
4. Add the new env vars to `.env.example`.

## 🗂️ Project layout

```
src/
├── pages/                 shared pages: home, login, settings hub
├── layouts/Layout.astro   shared layout, nav and theme
├── components/            GameNav, CrytoNav
├── lib/                   shared helpers (Supabase client, search, history, …)
└── games/
    ├── index.ts           finds every games/*/game.ts automatically
    ├── types.ts           the GameDefinition shape
    └── <id>/
        ├── game.ts        name, route, home card, env vars, settings links
        ├── pages/         the game's pages (pages/settings/<id>/new.astro → /settings/<id>/new)
        └── *.ts           game-only helpers
db/<id>/
├── schema.sql             full schema for a fresh Supabase project
├── migrations/            upgrades for databases made from older schemas
└── …                      catalog import scripts and data
game-pages.mjs             Astro integration that serves src/games/*/pages/
```

Game pages import shared code as `@/lib/...` and `@/layouts/...`.

## 📄 License

[MIT](LICENSE) © Cryto. Game names, artwork and song data belong to their
respective owners; home-page pictures are hotlinked from each game's official
site and never committed.
