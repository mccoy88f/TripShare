#!/usr/bin/env sh
# Aggiorna TripShare sul VPS: scarica il codice, ricompila le immagini e riavvia.
# Le migrazioni del database vengono applicate dall'API all'avvio.
set -eu
cd "$(dirname "$0")"
git pull --ff-only
docker compose build --pull
docker compose up -d --remove-orphans
docker image prune -f
docker compose ps
