# Basic production deployment

This setup is designed for one Linux host using Docker Compose and a host-level Nginx/Certbot
installation for TLS.

## Request path and ports

```text
Internet :443
  -> host Nginx (TLS)
  -> 127.0.0.1:8080
  -> frontend container Nginx :80
       /assets and SPA routes -> React static files
       /api/*                -> api container :4000
  -> PostgreSQL :5432 on an internal Docker network only
```

Only ports 80/443 of the host Nginx should be public. Port 8080 binds to localhost. Backend port
4000 and PostgreSQL port 5432 are internal and must not be exposed by the firewall.

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

Install `deploy/host-nginx-tls.example.conf` on the host, replace the domain and certificate paths,
enable the site, validate with `nginx -t`, and reload Nginx. Certbot can provision the referenced
Let's Encrypt certificate.

For an HTTP-only private smoke test, set `COOKIE_SECURE=false`, keep `HTTP_PORT=8080`, and browse to
`http://127.0.0.1:8080` from the host. Never use this HTTP mode over the public internet.

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
