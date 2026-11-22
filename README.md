# TAG! V14 — Nakama backend

This repository contains the TAG! browser client and a Nakama server runtime.

## Run locally

1. Install Docker Desktop.
2. Copy `.env.example` to `.env` and set strong values for `POSTGRES_PASSWORD` and `NAKAMA_SERVER_KEY`.
3. Run `docker compose up -d`.
4. Open the Nakama console at `http://localhost:7351` (default console credentials are documented by Heroic Labs; change them before exposing the service).
5. In TAG! Online, set server URL to `http://localhost:7350`, server key to the value of `NAKAMA_SERVER_KEY`, and a player name.

For a hosted deployment, deploy this repository with a persistent Postgres database and expose Nakama's client port (7350) over HTTPS. Set the same server key in the game's connection form. Do not commit production secrets.

## Included

- Browser client: `index.html`
- Nakama runtime match module: `server/modules/tag_match.lua`
- Docker Compose: Nakama + PostgreSQL

## Important gameplay/security note

The runtime owns room membership and relays match messages through Nakama. The current browser game still simulates player movement on a client-hosted model; this is suitable for a first playable friends beta, not cheat-resistant ranked competition. A production competitive release should move movement, tagging, scoring, round timers, and win validation into the authoritative runtime.

Nakama leaderboard `tag_online_wins` is initialized on server startup. The client can submit/read online wins. Online tournaments require tournament creation/scheduling and should be initialized before the tournament UI can list active events.

## Publish the browser client

The browser game is published separately from the Nakama backend.

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions** once.
3. Push changes to `index.html` or the publishing workflow. GitHub Actions validates the inline JavaScript and publishes the client automatically.

The expected project-site URL is:

`https://doggiedasher177-maker.github.io/Tagg/`

The Pages workflow only publishes `index.html`; Railway continues to host the Nakama backend. A successful workflow run is required before the Pages URL is live.
