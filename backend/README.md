## Backend notes

### Seed data (dev only)
Set env vars and run:
```bash
cd backend
SUPERADMIN_EMAIL=admin@example.com \
SUPERADMIN_PASSWORD=change-me \
TENANT_SLUG=acme \
TENANT_NAME="Acme MSP" \
SITE_SLUGS=lab,office,guest,warehouse \
SITE_DISPLAY_NAMES="Lab,Office,Guest,Warehouse" \
SITE_UNIFI_SITE_IDS=default,default,default,default \
UNIFI_BASE_URL=https://unifi.local \
UNIFI_API_KEY_REF=dev-unifi-key \
python -m app.scripts.seed
```

Optional defaults:
```bash
DEFAULT_TIME_LIMIT_MINUTES=60
DEFAULT_DATA_LIMIT_MB=500
DEFAULT_RX_KBPS=2000
DEFAULT_TX_KBPS=2000
```
