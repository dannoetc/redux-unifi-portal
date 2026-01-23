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

fix_cert_links() {
  local archive_dir="/etc/letsencrypt/archive/$PRIMARY_DOMAIN"
  if [ ! -d "$archive_dir" ]; then
    return 1
  fi
  local latest_fullchain latest_privkey
  latest_fullchain=$(ls -1 "$archive_dir"/fullchain*.pem 2>/dev/null | tail -n 1 || true)
  latest_privkey=$(ls -1 "$archive_dir"/privkey*.pem 2>/dev/null | tail -n 1 || true)
  if [ -n "$latest_fullchain" ] && [ -n "$latest_privkey" ]; then
    mkdir -p "$CERT_DIR"
    ln -sf "$latest_fullchain" "$CERT_PATH"
    ln -sf "$latest_privkey" "$KEY_PATH"
    return 0
  fi
  return 1
}

cert_valid() {
  if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
    return 1
  fi
  if ! openssl x509 -noout -in "$CERT_PATH" >/dev/null 2>&1; then
    return 1
  fi
  if ! openssl pkey -in "$KEY_PATH" -noout >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  ALT_CERT_DIR=""
  for dir in /etc/letsencrypt/live/*; do
    if [ -f "$dir/fullchain.pem" ] && [ -f "$dir/privkey.pem" ]; then
      ALT_CERT_DIR="$dir"
      break
    fi
  done

  if [ -n "$ALT_CERT_DIR" ]; then
    echo "Using existing cert from $ALT_CERT_DIR for $PRIMARY_DOMAIN"
    mkdir -p "$CERT_DIR"
    ln -sf "$ALT_CERT_DIR/fullchain.pem" "$CERT_PATH"
    ln -sf "$ALT_CERT_DIR/privkey.pem" "$KEY_PATH"
  else
    echo "Creating temporary self-signed cert for $PRIMARY_DOMAIN"
    mkdir -p "$CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "$KEY_PATH" -out "$CERT_PATH" \
      -subj "/CN=$PRIMARY_DOMAIN"
  fi
elif ! cert_valid; then
  echo "Existing certificate is invalid; attempting to re-link from archive."
  if ! fix_cert_links; then
    echo "Creating temporary self-signed cert for $PRIMARY_DOMAIN"
    mkdir -p "$CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "$KEY_PATH" -out "$CERT_PATH" \
      -subj "/CN=$PRIMARY_DOMAIN"
  fi
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
