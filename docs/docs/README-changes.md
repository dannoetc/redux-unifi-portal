# Docs changes (maintainer note)

What changed in this update:

- Added a one-page “idiot-proof” cheat sheet with step-by-step setup.
- Added `.env-sample` and expanded `.env.example` so all config variables are documented in one place.
- Updated admin + ops docs to mention OpenVPN and the config reference.
- Integrations now includes:
  - a friendlier explanation of UniFi behavior (including messy redirect URLs)
  - the “tenant-mode endpoints” rule in plain language
  - links to the UniFi quick reference cheat sheet

- Operations & Security now includes:
  - the nginx `X-Original-URI` idea (why it exists + what it solves)
  - a short troubleshooting section that matches what people actually hit in production

- Added `unifi-quickref.md`:
  - a simple “these are the calls we make” page for debugging without digging through code

Next step (optional):
- If we want even smoother on-call, add one page called “Troubleshooting” that’s just the top 10 issues with screenshots and fixes.
