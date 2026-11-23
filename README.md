# TAG! V19 — Living Legends & Nakama backend

This repository contains the TAG! browser client and a Nakama server runtime.

## Run locally

1. Install Docker Desktop.
2. Copy `.env.example` to `.env` and set strong values for `POSTGRES_PASSWORD` and `NAKAMA_SERVER_KEY`.
3. Run `docker compose up -d`.
4. Open the Nakama console at `http://localhost:7351` (default console credentials are documented by Heroic Labs; change them before exposing the service).
5. In TAG! Online, set server URL to `http://localhost:7350`, server key to the value of `NAKAMA_SERVER_KEY`, and a player name.

For a hosted deployment, deploy this repository with a persistent Postgres database and expose Nakama's client port (7350) over HTTPS. Set the same server key in the game's connection form. Do not commit production secrets.

## Included

- Browser client: `index.html` (V19 Living Legends)
- Published GitHub Pages client: `docs/index.html`
- Historical build viewer: `docs/history.html`
- Offline historical snapshots for V14–V18: `archive/legacy-offline/` (mirrored in `docs/archive/` for Pages)
- Nakama runtime match module: `server/modules/tag_match.lua`
- Docker Compose: Nakama + PostgreSQL

## Online architecture and security

The Nakama runtime owns match rooms, player membership, countdowns, round timers, tag checks, scoring, and match results. Clients simulate their own movement and send normalized position/velocity snapshots; the server rejects snapshots outside a movement envelope. This is a playable friends-beta architecture, not a fully cheat-resistant competitive movement simulation.

The runtime initializes the `tag_online_wins_v2`, `tag_online_losses_v2`, `tag_online_matches_v2`, and `tag_online_tags_v2` leaderboards, plus the `tag_weekly_v2` tournament.

## Publish the browser client

The browser game is published separately from the Nakama backend. The publish copy lives in `docs/index.html`; keep it identical to the root `index.html`.

One-time GitHub Pages setup:

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch `main` and folder `/docs`, then click **Save**.

GitHub Pages then publishes updates whenever `docs/` changes on `main`. The expected project-site URL is:

`https://doggiedasher177-maker.github.io/Tagg/`

The Nakama multiplayer backend remains hosted separately on Railway. The GitHub Actions validation workflow checks that the published copy matches the source, both browser scripts parse successfully, and V15–V19 feature guards remain present. V1–V14 numbered originals are preserved in the companion offline archive pack.
