#!/bin/sh
set -e

if [ -z "$DOMAIN" ]; then
  echo "DOMAIN is not set"
  exit 1
fi

PRIMARY_DOMAIN=$(printf '%s' "$DOMAIN" | cut -d',' -f1 | tr -d ' ')
export PRIMARY_DOMAIN

envsubst '$DOMAIN $PRIMARY_DOMAIN' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

CERT_DIR="/etc/letsencrypt/live/$PRIMARY_DOMAIN"
CERT_PATH="$CERT_DIR/fullchain.pem"
KEY_PATH="$CERT_DIR/privkey.pem"

if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo "Creating temporary self-signed cert for $PRIMARY_DOMAIN"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$KEY_PATH" -out "$CERT_PATH" \
    -subj "/CN=$PRIMARY_DOMAIN"
fi

# Watch cert fingerprint and reload nginx if it changes (works if certbot overwrites self-signed cert)
get_fp() {
  if [ -f "$CERT_PATH" ]; then
    openssl x509 -noout -fingerprint -sha256 -in "$CERT_PATH" 2>/dev/null | sed 's/.*=//; s/://g'
  else
    echo ""
  fi
}

watch_cert() {
  prev_fp=$(get_fp)
  while true; do
    sleep 5
    fp=$(get_fp)
    if [ -n "$fp" ] && [ "$fp" != "$prev_fp" ]; then
      echo "Certificate changed - reloading nginx"
      nginx -s reload || true
      prev_fp="$fp"
    fi
  done
}

watch_cert &

exec nginx -g 'daemon off;'
