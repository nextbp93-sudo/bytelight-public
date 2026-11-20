#!/usr/bin/env bash
set -euo pipefail

# Deploy the committed house checkout without touching private runtime state.
# This script is intentionally specific to Jaclyn's single-user VPS layout.

LIVE_ROOT="/opt/bytelight"
SERVICE="bytelight.service"
HEALTH_URL="${BYTELIGHT_HEALTH_URL:-http://127.0.0.1:3002/api/health}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

die() {
  echo "deploy-live: $*" >&2
  exit 1
}

[[ "$LIVE_ROOT" == "/opt/bytelight" ]] || die "refusing unexpected live root: $LIVE_ROOT"
[[ -d "$REPO_ROOT/.git" ]] || die "run this from the writable Git checkout"
[[ -f "$LIVE_ROOT/bytelight.yaml" ]] || die "live config is missing at $LIVE_ROOT/bytelight.yaml"
[[ -d "$LIVE_ROOT/data" ]] || die "live data directory is missing at $LIVE_ROOT/data"
[[ -w "$LIVE_ROOT/packages" ]] || die "$LIVE_ROOT/packages is not writable by $(id -un)"
[[ -w "$LIVE_ROOT/node_modules" ]] || die "$LIVE_ROOT/node_modules is not writable by $(id -un)"
command -v rsync >/dev/null || die "rsync is required"
command -v npm >/dev/null || die "npm is required"

COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify HEAD)"
STAGING="$(mktemp -d /tmp/bytelight-deploy.XXXXXX)"
cleanup() {
  case "$STAGING" in
    /tmp/bytelight-deploy.*) rm -rf -- "$STAGING" ;;
    *) echo "deploy-live: refusing to remove unexpected staging path: $STAGING" >&2 ;;
  esac
}
trap cleanup EXIT

echo "Deploying committed HEAD ${COMMIT:0:12}"
git -C "$REPO_ROOT" archive HEAD | tar -x -C "$STAGING"

LOCK_CHANGED=0
if ! cmp -s "$STAGING/package-lock.json" "$LIVE_ROOT/package-lock.json"; then
  LOCK_CHANGED=1
fi

echo "Installing isolated staging dependencies"
(cd "$STAGING" && npm ci)
(cd "$STAGING" && npm run build)

# --delete applies only to the committed code surface. Excluded private/runtime
# paths are preserved in place and are never copied out of the checkout.
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.mcp.json' \
  --exclude='AGENTS.md' \
  --exclude='CLAUDE.md' \
  --exclude='bytelight.yaml' \
  --exclude='ecosystem.config.cjs' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='backups/' \
  --exclude='node_modules/' \
  --exclude='*.key' \
  --exclude='*.pem' \
  "$STAGING/" "$LIVE_ROOT/"

if [[ "$LOCK_CHANGED" -eq 1 ]]; then
  echo "Installing updated live dependencies"
  (cd "$LIVE_ROOT" && npm ci)
fi

sudo -n /usr/bin/systemctl restart "$SERVICE"
sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE"

for attempt in {1..30}; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "Live and healthy: ${COMMIT}"
    exit 0
  fi
  sleep 1
done

die "service restarted but health did not recover at $HEALTH_URL"
