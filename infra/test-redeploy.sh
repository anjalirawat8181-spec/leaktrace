#!/bin/bash
# Tests redeploy-api.sh in a sandbox: fake aws/systemctl/nginx/curl, real tarballs from ./release.
# Usage: bash infra/test-redeploy.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
pass=0; fail=0
check() { if eval "$2"; then echo "  ok   $1"; pass=$((pass+1)); else echo "  FAIL $1"; fail=$((fail+1)); fi; }

mkdir -p "$SB/bin" "$SB/s3" "$SB/calls"
cat > "$SB/bin/aws" <<'S'
#!/bin/bash
# aws s3 cp s3://bucket/key dest ...
key="${3#s3://*/}"; cp "$FAKE_S3/$key" "$4"
S
cat > "$SB/bin/systemctl" <<'S'
#!/bin/bash
echo "systemctl $*" >> "$CALLS"; [ "$1" = "is-active" ] && echo active; exit 0
S
cat > "$SB/bin/nginx" <<'S'
#!/bin/bash
echo "nginx $*" >> "$CALLS"; [ -n "${FAKE_NGINX_FAIL:-}" ] && exit 1; exit 0
S
cat > "$SB/bin/curl" <<'S'
#!/bin/bash
[ -n "${FAKE_HEALTH_FAIL:-}" ] && exit 22; echo '{"status":"ok"}'
S
cat > "$SB/bin/runuser" <<'S'
#!/bin/bash
shift 2; exec "$@"
S
cat > "$SB/bin/node" <<'S'
#!/bin/bash
echo "node $*" >> "$CALLS"; [ -n "${FAKE_MIGRATE_FAIL:-}" ] && { echo "migration boom" >&2; exit 1; }; exit 0
S
cat > "$SB/bin/journalctl" <<'S'
#!/bin/bash
echo "(journal)"
S
chmod +x "$SB/bin"/*

new_server() {
  rm -rf "$SB/opt" "$SB/www" "$SB/etc" "$SB/calls"/*; mkdir -p "$SB/opt/api" "$SB/www" "$SB/etc"
  echo OLD > "$SB/opt/api/VERSION"; echo OLD > "$SB/www/index.html"
  echo "old nginx" > "$SB/etc/nginx.conf"; echo "old unit" > "$SB/etc/leaktrace-api.service"
  cp "$ROOT/release/api.tar.gz" "$ROOT/release/web.tar.gz" "$SB/s3/"
}
run() {
  env PATH="$SB/bin:$PATH" FAKE_S3="$SB/s3" CALLS="$SB/calls/log" SKIP_ROOT_CHECK=1 HEALTH_TRIES=2 \
    APP_ROOT="$SB/opt" APP_DIR="$SB/opt/api" WEB_DIR="$SB/www" UNIT_FILE="$SB/etc/leaktrace-api.service" \
    NGINX_CONF="$SB/etc/nginx.conf" "$@" bash "$ROOT/infra/redeploy-api.sh" > "$SB/out.txt" 2>&1
}

echo "1. normal redeploy"
new_server; run; code=$?
check "exits 0" "[ $code -eq 0 ]"
check "new API is in place" "[ -f $SB/opt/api/dist/server.js ] && [ ! -f $SB/opt/api/VERSION ]"
check "new website is in place" "grep -q '<div id=\"root\">' $SB/www/index.html"
check "old API kept as a backup" "ls $SB/opt/backups/*/api/VERSION >/dev/null"
check "old website kept as a backup" "ls $SB/opt/backups/*/web/index.html >/dev/null"
check "migration ran" "grep -q 'dist/migrate.js' $SB/calls/log"
check "API restarted and nginx reloaded" "grep -q 'systemctl restart leaktrace-api' $SB/calls/log && grep -q 'systemctl reload nginx' $SB/calls/log"
check "service file uses port 3000 behind nginx" "grep -q 'PORT=3000' $SB/etc/leaktrace-api.service && grep -q 'TRUST_PROXY=loopback' $SB/etc/leaktrace-api.service"
check "nginx proxies /api/ and falls back to index.html" "grep -q 'proxy_pass http://127.0.0.1:3000' $SB/etc/nginx.conf && grep -q 'try_files \$uri /index.html' $SB/etc/nginx.conf"
check "prints the health result" "grep -q 'curl localhost/api/health -> {\"status\":\"ok\"}' $SB/out.txt"

echo "2. broken api.tar.gz changes nothing"
new_server; mkdir -p "$SB/bad" && echo x > "$SB/bad/package.json" && tar -czf "$SB/s3/api.tar.gz" -C "$SB/bad" package.json
run; code=$?
check "exits non-zero" "[ $code -ne 0 ]"
check "old API untouched" "grep -q OLD $SB/opt/api/VERSION"
check "service never stopped" "! grep -q 'systemctl stop' $SB/calls/log"

echo "3. migration failure rolls back"
new_server; run FAKE_MIGRATE_FAIL=1; code=$?
check "exits non-zero" "[ $code -ne 0 ]"
check "old API restored" "grep -q OLD $SB/opt/api/VERSION && [ ! -f $SB/opt/api/dist/server.js ]"
check "old website restored" "grep -q OLD $SB/www/index.html"
check "old nginx and service files restored" "grep -q 'old nginx' $SB/etc/nginx.conf && grep -q 'old unit' $SB/etc/leaktrace-api.service"
check "says it rolled back" "grep -q 'ROLLING BACK' $SB/out.txt"

echo "4. unhealthy API rolls back"
new_server; run FAKE_HEALTH_FAIL=1; code=$?
check "exits non-zero" "[ $code -ne 0 ]"
check "old API restored" "grep -q OLD $SB/opt/api/VERSION"
check "old website restored" "grep -q OLD $SB/www/index.html"

echo "5. bad nginx settings roll back"
new_server; run FAKE_NGINX_FAIL=1; code=$?
check "exits non-zero" "[ $code -ne 0 ]"
check "old API restored" "grep -q OLD $SB/opt/api/VERSION"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
