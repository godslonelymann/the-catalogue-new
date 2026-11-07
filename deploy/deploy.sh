#!/usr/bin/env bash
# Deploys the latest `main` on the EC2 server. Run it on the server:
#
#     ~/the-catalogue-new/deploy/deploy.sh
#
# Steps: back up the database, pull, install, migrate, build, publish the app files, restart the API.
# It stops at the first error, so a failed step never restarts the API with half an update.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "1/6  Backing up the database"
sudo systemctl start the-catalogue-backup.service

echo "2/6  Pulling main"
git pull --ff-only

echo "3/6  Installing the backend and running migrations"
(cd backend && uv sync --locked --no-dev && uv run --no-sync alembic upgrade head)

echo "4/6  Building the frontend"
(cd frontend && npm ci --no-audit --no-fund && npm run build)

echo "5/6  Publishing the app files for Caddy"
sudo rsync -a --delete --chmod=D755,F644 frontend/dist/ /srv/the-catalogue/

echo "6/6  Restarting the API"
sudo systemctl restart the-catalogue-api
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
    echo "Done. The API is up."
    exit 0
  fi
  sleep 1
done
echo "The API did not start. Check: journalctl -u the-catalogue-api -n 50" >&2
exit 1
