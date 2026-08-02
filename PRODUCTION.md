# Basic production deployment

This setup is designed for one Linux host using Docker Compose and a host-level Nginx/Certbot
installation for TLS.

## Request path and ports

```text
Internet :443
  -> host Nginx (TLS)
       / and SPA routes -> 127.0.0.1:5173 (frontend)
       /api/*           -> 127.0.0.1:4000 (API)
  -> PostgreSQL :5432 on an internal Docker network only
```

Only ports 80/443 of the host Nginx should be public. Frontend port 5173 and API port 4000 bind to
localhost. PostgreSQL remains on an internal Docker network.

## First deployment

Use a fresh production database/volume. The initial migration creates the complete schema.

```bash
cp .env.production.example .env.production
openssl rand -base64 48
```

Put the generated value in `JWT_SECRET`, replace every `CHANGE_ME`, and set the exact HTTPS URL in
`PUBLIC_ORIGIN`. Then start:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api frontend
```

The API applies committed Prisma migrations and creates the initial administrator idempotently.
Demo data is disabled.

For an HTTP-only private smoke test, set `COOKIE_SECURE=false`, keep `HTTP_PORT=5173`, and browse to
`http://127.0.0.1:5173` from the host. Never use this HTTP mode over the public internet.

## Operations

Create a database backup before every upgrade:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U sprintforge -d sprintforge -Fc > sprintforge.dump
```

Restore into an empty database after stopping the API:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U sprintforge -d sprintforge --clean --if-exists < sprintforge.dump
docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

Upgrade with:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Attachments are stored as Base64 JSON in PostgreSQL in this basic deployment. Individual files are
limited to 5 MB and requests to 25 MB. Monitor database growth and keep tested off-host backups.

If an existing database was previously created with `prisma db push`, do not run the initial
migration against it blindly. Back it up and baseline/migrate it separately.
