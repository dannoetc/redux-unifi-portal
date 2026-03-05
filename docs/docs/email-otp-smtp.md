# Email OTP (SMTP)

Email OTP allows guests to verify with a one-time code.

## Prerequisites

- reachable SMTP host
- sender address you control
- SPF/DKIM/DMARC configured for deliverability

## Configure SMTP in `.env`

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=25
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=wifi@example.com
SMTP_FROM_NAME="Example WiFi"
```

If your provider requires auth, set username/password.

## Apply changes

```bash
docker compose up -d
```

## Validate guest flow

1. Connect test device to SSID.
2. Choose `Email OTP` in the guest portal.
3. Submit email and verify received code.
4. Confirm guest receives internet access.

## Troubleshooting

- No email sent: check `celery` logs.
- Email in spam: fix sender reputation and DNS records.
- SMTP blocked: move to approved relay/port for your hosting provider.
