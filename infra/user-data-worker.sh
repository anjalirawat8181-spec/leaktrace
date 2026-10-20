#!/bin/bash
set -euxo pipefail
exec > >(tee -a /var/log/leaktrace-user-data.log) 2>&1

REGION=ap-south-1
BUCKET=leaktrace-deploy-ccl2026
APP_DIR=/opt/leaktrace/worker

dnf install -y nodejs20 postgresql16
if [ ! -x /usr/bin/node ]; then
  ln -sf "$(ls /usr/bin/node-20* | head -1)" /usr/bin/node
fi

id leaktrace >/dev/null 2>&1 || useradd --system --home-dir /opt/leaktrace --shell /sbin/nologin leaktrace
mkdir -p "$APP_DIR"
aws s3 cp "s3://${BUCKET}/worker.tar.gz" /tmp/worker.tar.gz --region "$REGION"
tar -xzf /tmp/worker.tar.gz -C "$APP_DIR"
rm -f /tmp/worker.tar.gz
chown -R leaktrace:leaktrace /opt/leaktrace

cat > /etc/systemd/system/leaktrace-worker.service <<'UNIT'
[Unit]
Description=LeakTrace generation worker
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=leaktrace
WorkingDirectory=/opt/leaktrace/worker
Environment=APP_MODE=aws
Environment=NODE_ENV=production
Environment=AWS_REGION=ap-south-1
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now leaktrace-worker
