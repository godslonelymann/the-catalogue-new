# Production server (EC2)

The live site is **https://thecatalogue.duckdns.org**. One Ubuntu server runs everything. PulseGrid shares the server but has its own services and its own Caddy block.

```
 Browser ──HTTPS──> Caddy ─┬─ /api/*  ──> uvicorn on 127.0.0.1:8000 (the-catalogue-api)
                           └─ other   ──> /srv/the-catalogue (the built React app)
                                               │
                                   PostgreSQL 18, database "catalogue"
```

## What runs

| Unit | What it does | When |
|---|---|---|
| `the-catalogue-api.service` | The FastAPI app, 2 workers | Always |
| `the-catalogue-refresh.timer` | Re-checks every monitored store, reads its products, records updates, then sends restock emails | Daily, 06:00 IST |
| `the-catalogue-send-alerts.timer` | Tries failed restock emails again | Hourly, at :30 |
| `the-catalogue-backup.timer` | `pg_dump` to `/var/backups/the-catalogue`, keeps 14 days | Daily, 03:00 IST |

Copies of these units are in `systemd/`. The Caddy block is in `Caddyfile.the-catalogue`. The old address `the-catalogue.duckdns.org` redirects to the new one.

## Settings

`/home/ubuntu/the-catalogue-new/.env` (mode `600`, not in git). The database passwords and app keys were generated on the server. Add these yourself:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `SMTP_USERNAME`, `SMTP_PASSWORD` (a Gmail app password), `EMAIL_FROM`

Then restart the API: `sudo systemctl restart the-catalogue-api`.

Google Cloud Console, for the OAuth client:

- Authorized redirect URI: `https://thecatalogue.duckdns.org/api/auth/google/callback`
- Authorized JavaScript origin: `https://thecatalogue.duckdns.org`

## Database

| Role | Used by | Can do |
|---|---|---|
| `catalogue_owner` | Migrations (`MIGRATION_DATABASE_URL`) | Owns the tables |
| `catalogue_api` | The API and the jobs (`DATABASE_URL`) | Read, insert, update, delete rows. No table changes. |

## Update the live site

Push to `main`, then on the server:

```bash
~/the-catalogue-new/deploy/deploy.sh
```

It backs up the database, pulls, installs, migrates, builds, publishes, and restarts the API.

## Useful commands

```bash
systemctl status the-catalogue-api
journalctl -u the-catalogue-api -n 100
systemctl list-timers 'the-catalogue-*'
sudo systemctl start the-catalogue-refresh.service    # refresh now
journalctl -u the-catalogue-refresh -n 50             # last refresh log
sudo ls -l /var/backups/the-catalogue
```

Restore a backup (stops the API first):

```bash
sudo systemctl stop the-catalogue-api
sudo -u postgres pg_restore --clean --if-exists -d catalogue /var/backups/the-catalogue/catalogue-YYYYMMDD.dump
sudo systemctl start the-catalogue-api
```

Backups are on the same disk as the database. Copy them off the server now and then, for example with `scp`.
