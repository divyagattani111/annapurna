#!/bin/bash
set -e

echo "==> 1. Pulling latest changes from GitHub (main)..."
git pull origin main

echo "==> 2. Rebuilding Docker containers..."
docker compose --env-file .env.production -f infra/compose.yaml build

echo "==> 3. Running any new database migrations..."
docker compose --env-file .env.production -f infra/compose.yaml --profile operations run --rm -e APPROVED_MIGRATION=yes migrate

echo "==> 4. Restarting services..."
docker compose --env-file .env.production -f infra/compose.yaml up -d --wait api caddy

echo "==> Deployment complete! Live at https://annapurnadivya.co.in"
