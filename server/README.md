# SprintForge API

A small Express + Prisma (PostgreSQL) backend for SprintForge. The frontend keeps working purely
off `localStorage` if this isn't running or `VITE_API_URL` isn't set — this is additive, not a
replacement.

## How syncing works

The frontend still computes state client-side with its existing reducer (instant, optimistic UI).
When `VITE_API_URL` is set, `StoreProvider` additionally:

1. On first load of a project, calls `GET /api/projects/:id`. If it exists on the server, that
   becomes the source of truth (overwrites local state for that project). If not, it `POST`s the
   local copy to create it there.
2. After every change, waits 600ms of inactivity then `PUT`s the whole current project — the
   server reconciles every child table (stories, sprints, epics, members, whiteboard) in one
   transaction: upserts what's present, deletes what's missing.

If the server is unreachable, every API call fails silently and the app carries on with
`localStorage` only.

## Local development

The recommended workflow is to start the complete stack from the repository root:

```bash
docker compose up --build
```

Compose waits for PostgreSQL, generates the Prisma client, applies the current schema with
`prisma db push`, and then starts the API with hot reload. No manual `.env` files or database setup
are needed for this workflow.

To run only the API directly with npm, first start or provide a Postgres instance:

```bash
cd server
cp .env.example .env
npm install
npx prisma db push
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
