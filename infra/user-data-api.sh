#!/bin/bash
# First-boot setup for the LeakTrace API server (Amazon Linux 2023). Runs once as root.
# Result: nginx on port 80 serves the website and forwards /api/ to the API on 127.0.0.1:3000.
set -euxo pipefail
exec > >(tee -a /var/log/leaktrace-user-data.log) 2>&1

REGION=ap-south-1
BUCKET=leaktrace-deploy-ccl2026
APP_DIR=/opt/leaktrace/api
WEB_DIR=/var/www/leaktrace

dnf install -y nodejs20 postgresql16 nginx
if [ ! -x /usr/bin/node ]; then
  ln -sf "$(ls /usr/bin/node-20* | head -1)" /usr/bin/node
fi

id leaktrace >/dev/null 2>&1 || useradd --system --home-dir /opt/leaktrace --shell /sbin/nologin leaktrace
mkdir -p "$APP_DIR" "$WEB_DIR" /opt/leaktrace/backups

aws s3 cp "s3://${BUCKET}/api.tar.gz" /tmp/api.tar.gz --region "$REGION"
aws s3 cp "s3://${BUCKET}/web.tar.gz" /tmp/web.tar.gz --region "$REGION"
tar -xzf /tmp/api.tar.gz -C "$APP_DIR"
tar -xzf /tmp/web.tar.gz -C "$WEB_DIR"
rm -f /tmp/api.tar.gz /tmp/web.tar.gz
chown -R leaktrace:leaktrace /opt/leaktrace
chmod -R a+rX "$WEB_DIR"

cat > /etc/systemd/system/leaktrace-api.service <<'UNIT'
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

cat > /etc/nginx/nginx.conf <<'NGINX'
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

nginx -t
systemctl daemon-reload
systemctl enable --now leaktrace-api
systemctl enable --now nginx
