#!/bin/bash
# Redeploy the LeakTrace API and website on the existing server.
#
# Run it through Session Manager:
#   aws s3 cp s3://leaktrace-deploy-ccl2026/redeploy-api.sh /tmp/redeploy-api.sh --region ap-south-1 && sudo bash /tmp/redeploy-api.sh
#
# It downloads api.tar.gz and web.tar.gz, checks them, keeps the old version as a backup,
# swaps the new files in, runs the database migrations, restarts the API, reloads nginx
# and prints the health check. If anything fails it puts the old version back.
set -euo pipefail

REGION="${REGION:-ap-south-1}"
BUCKET="${BUCKET:-leaktrace-deploy-ccl2026}"
APP_ROOT="${APP_ROOT:-/opt/leaktrace}"
APP_DIR="${APP_DIR:-$APP_ROOT/api}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_ROOT/backups}"
WEB_DIR="${WEB_DIR:-/var/www/leaktrace}"
UNIT_FILE="${UNIT_FILE:-/etc/systemd/system/leaktrace-api.service}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/nginx.conf}"
APP_USER="${APP_USER:-leaktrace}"
RUN_AS="${RUN_AS:-runuser -u $APP_USER --}"
KEEP_BACKUPS="${KEEP_BACKUPS:-3}"
HEALTH_URL_API="${HEALTH_URL_API:-http://127.0.0.1:3000/api/health}"
HEALTH_URL_SITE="${HEALTH_URL_SITE:-http://localhost/api/health}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"

if [ "${SKIP_ROOT_CHECK:-}" != "1" ] && [ "$(id -u)" -ne 0 ]; then
  echo "Please run this with sudo: sudo bash $0" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
BACKUP="$BACKUP_ROOT/$STAMP"
SWAPPED_API=0
SWAPPED_WEB=0
trap 'rm -rf "$WORK"' EXIT

say() { echo; echo "==> $*"; }

say "1/8 Downloading the new files from s3://$BUCKET"
aws s3 cp "s3://$BUCKET/api.tar.gz" "$WORK/api.tar.gz" --region "$REGION"
aws s3 cp "s3://$BUCKET/web.tar.gz" "$WORK/web.tar.gz" --region "$REGION"

say "2/8 Checking the files before touching anything"
mkdir -p "$WORK/api" "$WORK/web"
tar -xzf "$WORK/api.tar.gz" -C "$WORK/api"
tar -xzf "$WORK/web.tar.gz" -C "$WORK/web"
for f in package.json dist/server.js dist/migrate.js; do
  [ -f "$WORK/api/$f" ] || { echo "api.tar.gz is missing $f. Nothing was changed." >&2; exit 1; }
done
[ -f "$WORK/web/index.html" ] || { echo "web.tar.gz has no index.html at its root. Nothing was changed." >&2; exit 1; }
echo "api.tar.gz and web.tar.gz look right."

rollback() {
  say "ROLLING BACK to the previous version"
  systemctl stop leaktrace-api || true
  if [ "$SWAPPED_API" = 1 ]; then
    rm -rf "$APP_DIR"
    mv "$BACKUP/api" "$APP_DIR"
  fi
  if [ "$SWAPPED_WEB" = 1 ]; then
    rm -rf "$WEB_DIR"
    mv "$BACKUP/web" "$WEB_DIR"
  fi
  [ -f "$BACKUP/nginx.conf" ] && cp -f "$BACKUP/nginx.conf" "$NGINX_CONF"
  [ -f "$BACKUP/leaktrace-api.service" ] && cp -f "$BACKUP/leaktrace-api.service" "$UNIT_FILE"
  systemctl daemon-reload || true
  systemctl start leaktrace-api || true
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  echo "The old version is running again. Look at: journalctl -u leaktrace-api -n 50 --no-pager" >&2
}

say "3/8 Backing up the current version to $BACKUP"
mkdir -p "$BACKUP"
[ -f "$NGINX_CONF" ] && cp -f "$NGINX_CONF" "$BACKUP/nginx.conf"
[ -f "$UNIT_FILE" ] && cp -f "$UNIT_FILE" "$BACKUP/leaktrace-api.service"

say "4/8 Swapping in the new files"
systemctl stop leaktrace-api || true
mkdir -p "$APP_DIR" "$WEB_DIR"
mv "$APP_DIR" "$BACKUP/api"
mv "$WORK/api" "$APP_DIR"
SWAPPED_API=1
mv "$WEB_DIR" "$BACKUP/web"
mv "$WORK/web" "$WEB_DIR"
SWAPPED_WEB=1
chown -R "$APP_USER:$APP_USER" "$APP_DIR" 2>/dev/null || chown -R "$APP_USER" "$APP_DIR" || true
chmod -R a+rX "$WEB_DIR"

say "5/8 Writing the service and nginx settings"
cat > "$UNIT_FILE" <<'UNIT'
[Unit]
Description=LeakTrace API
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=leaktrace
WorkingDirectory=/opt/leaktrace/api
Environment=APP_MODE=aws
Environment=NODE_ENV=production
Environment=AWS_REGION=ap-south-1
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=loopback
ExecStartPre=/usr/bin/node dist/migrate.js
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
UNIT
cat > "$NGINX_CONF" <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log notice;
pid /run/nginx.pid;

events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /var/log/nginx/access.log;
  sendfile on;
  keepalive_timeout 65;
  server_tokens off;
  client_max_body_size 25m;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/leaktrace;
    index index.html;

    location /api/ {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 60s;
    }

    location /assets/ {
      add_header Cache-Control "public, max-age=31536000, immutable";
      try_files $uri =404;
    }

    location = /index.html {
      add_header Cache-Control "no-cache, must-revalidate";
    }

    location / {
      add_header Cache-Control "no-cache, must-revalidate";
      try_files $uri /index.html;
    }
  }
}
NGINX
if ! nginx -t; then
  echo "The nginx settings did not pass nginx -t." >&2
  rollback
  exit 1
fi

say "6/8 Running the database migrations"
if ! (cd "$APP_DIR" && $RUN_AS env APP_MODE=aws AWS_REGION="$REGION" node dist/migrate.js); then
  echo "The migration failed." >&2
  rollback
  exit 1
fi

say "7/8 Restarting the API and reloading nginx"
systemctl daemon-reload
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl restart leaktrace-api
systemctl reload nginx || systemctl restart nginx

healthy=0
for i in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS "$HEALTH_URL_API" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then
  echo "The API did not become healthy in time. Last log lines:" >&2
  journalctl -u leaktrace-api -n 30 --no-pager >&2 || true
  rollback
  exit 1
fi

say "8/8 Result"
echo -n "curl localhost/api/health -> "
curl -sS "$HEALTH_URL_SITE"
echo
systemctl is-active leaktrace-api nginx || true

ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -rf
echo
echo "Deploy finished. The previous version is kept in $BACKUP"
echo "To go back by hand: sudo systemctl stop leaktrace-api && sudo rm -rf $APP_DIR && sudo mv $BACKUP/api $APP_DIR && sudo systemctl start leaktrace-api"
