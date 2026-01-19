#!/bin/sh
set -e

ENV_JS_PATH="/app/public/env.js"

escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

API_BASE_URL_ESCAPED=$(escape "${NEXT_PUBLIC_API_BASE_URL:-}")

cat > "$ENV_JS_PATH" <<EOF
window.__ENV__ = window.__ENV__ || {};
window.__ENV__.NEXT_PUBLIC_API_BASE_URL = "${API_BASE_URL_ESCAPED}";
EOF

exec "$@"
