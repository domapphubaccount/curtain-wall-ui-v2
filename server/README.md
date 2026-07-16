# SprintForge API

A small Express + Prisma (PostgreSQL) backend for SprintForge. It is the authoritative source for
users, project membership, projects, and tasks.

## How syncing works

The frontend retains its reducer for responsive UI and sends a debounced project snapshot. The API
reconciles admin changes transactionally. For normal users it computes the allowed delta and only
accepts changes to tasks assigned to their authenticated database account; all other mutations are
rejected with `403` and the frontend reloads the authoritative project.

JWT sessions are stored in HTTP-only, SameSite cookies. Passwords are bcrypt-hashed, login attempts
are rate-limited, inactive accounts are rejected, and the system always preserves at least one
active administrator.

## Local development

The recommended workflow is to start the complete stack from the repository root:

```bash
docker compose up --build
```

Compose waits for PostgreSQL, generates the Prisma client, applies the current schema with
`prisma db push`, idempotently creates the initial administrator and demo data, and then starts the
API with hot reload. No manual database setup is needed for this workflow.

To run only the API directly with npm, first start or provide a Postgres instance:

```bash
cd server
cp .env.example .env
npm install
npx prisma db push
npm run db:bootstrap
npm run dev                   # starts the API on http://localhost:4000
```

Then, in the repo root, copy `.env.example` to `.env` and set `VITE_API_URL=http://localhost:4000`,
restart `npm run dev` for the frontend, and it'll start syncing.

Point `DATABASE_URL` in `server/.env` at any PostgreSQL server available from your machine.

## Deploying remotely

This needs two things, on any host that runs Node + Postgres (Render, Railway, Fly.io, a plain VPS,
etc.) — I don't have cloud credentials to provision these myself, so you'll need to create the
accounts:

1. **A Postgres database.** Managed Postgres from your hosting provider, or a separate service like
   Neon/Supabase. Get its connection string.
2. **The API server**, deployed from `server/` (it has a `Dockerfile`). Set env vars:
   - `DATABASE_URL` — the connection string from step 1.
   - `CORS_ORIGIN` — your deployed frontend's URL (comma-separated if there's more than one).
   - `JWT_SECRET` — a random secret of at least 32 characters.
   - `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` — first-run admin.
   - `COOKIE_SECURE=true` — required when the deployed app uses HTTPS.
   - `PORT` — most platforms set this for you.
   This repository does not currently contain versioned Prisma migrations. Run `npx prisma db push`
   as a deployment/release step before starting the production image, or add and commit migrations
   before switching that release step to `prisma migrate deploy`.
3. **The frontend**: set `VITE_API_URL` to the deployed API's URL at build time, then deploy `dist/`
   (from `npm run build` in the repo root) to any static host (Vercel, Netlify, Cloudflare Pages,
   the same server via a static file middleware, etc.).

## What this does *not* include

No authentication — anyone with the API URL can read/write any project. Fine for a private demo or
an internal tool behind your own network/VPN; not fine for a public deployment as-is. Adding real
auth (e.g. sessions + a `users` table, or an auth provider) is a follow-up, not bundled here.
