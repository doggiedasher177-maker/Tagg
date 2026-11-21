# Deploy TAG! Nakama on Railway

1. Create a Railway project from this GitHub repository and add a PostgreSQL service.
2. Deploy the repository as a service using the included Dockerfile.
3. In the Nakama service, add these variables using Railway's reference picker:
   - `NAKAMA_DATABASE_ADDRESS`: construct the Nakama DSN from the Postgres service's PGUSER, PGPASSWORD, PGHOST, PGPORT, and PGDATABASE values, in the form `user:password@host:port/database?sslmode=require`.
   - `NAKAMA_SERVER_KEY`: a long random secret (keep private).
4. Generate a public domain for the Nakama service on port 7350. Use HTTPS/WSS in production.
5. Configure the TAG! client with that public URL and the server key. Never publish production secrets in this repository or in screenshots.

Nakama's console port 7351 should remain private; do not expose it publicly.

A successful Railway deployment still needs a real Railway account/project, a PostgreSQL service, and the environment variables above. The repository configuration alone does not deploy or provision those resources.
