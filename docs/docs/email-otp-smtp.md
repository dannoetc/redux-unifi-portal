# Email OTP (SMTP) Setup (step-by-step)

Email OTP lets guests verify an email address and receive a one-time code.

Important: the backend sends email using a basic SMTP client. If your mail provider requires STARTTLS or special auth flows,
you may need an SMTP relay that supports plain SMTP from the server.

---

## 0) What you need

- An SMTP server reachable from your portal server
- The “from” address you want guests to see (example: `wifi@example.com`)
- Deliverability configured (SPF/DKIM/DMARC) so codes don’t go to spam

---

## 1) Set SMTP variables in `.env`

Edit your `.env` (at the repo root on the server) and set:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=25
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=wifi@example.com
SMTP_FROM_NAME="Example WiFi"
```

If your SMTP server requires auth, set username/password.

---

## 2) Restart the stack

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx-certbot.yml up -d
```

---

## 3) Test OTP

1. Go to the guest portal (or connect a device to the hotspot WiFi)
2. Choose **Email OTP**
3. Enter your email
4. Confirm you receive a code and can complete auth

---

## 4) Debugging

### Codes aren’t sending
Check the Celery worker logs (OTP is sent in a background job):

```bash
docker compose logs -f celery
```

Also check the API logs:

```bash
docker compose logs -f api
```

### Codes are sending but landing in spam
That’s almost always deliverability:
- SPF/DKIM/DMARC
- sender reputation
- using a domain you own (not a random free mailbox)

### Port blocked
Some hosting environments block outbound SMTP (especially port 25). If so:
- use your provider’s approved relay port
- or use an SMTP relay inside your network
