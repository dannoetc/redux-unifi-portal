#!/bin/sh
set -e

if [ -z "$DOMAIN" ]; then
  echo "DOMAIN is not set"
  exit 1
fi

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
CERT_PATH="$CERT_DIR/fullchain.pem"
KEY_PATH="$CERT_DIR/privkey.pem"

if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo "Creating temporary self-signed cert for $DOMAIN"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$KEY_PATH" -out "$CERT_PATH" \
    -subj "/CN=$DOMAIN"
fi

exec nginx -g 'daemon off;'
