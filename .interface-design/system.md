# ReduxTC UniFi Admin Interface System

## Direction and feel
- Intent: MSP operators need fast visibility into guest access health, authentication conversion, and site-level anomalies without digging through raw logs.
- Tone: Operational, calm, and precise. A control-room feel rather than marketing visuals.
- Core framing: "Guest Access Operations" as the dashboard signature that combines authentication outcomes and click-through traffic.

## Depth strategy
- Primary strategy: subtle borders + low-contrast surface layering.
- Canvas/shell: neutral background with quiet separation between navigation and content.
- Cards: rounded medium corners, soft border emphasis, restrained shadow (`shadow-soft`) for hierarchy without visual noise.
- Controls: inset-like backgrounds (`bg-background` inside muted containers) with clear focus rings.

## Spacing and rhythm
- Base spacing unit: 4px.
- Common composition cadence:
  - Card padding: 20px to 24px.
  - Section gaps: 16px to 24px.
  - Dense data rows: 8px to 12px vertical rhythm.
- Avoid mixed ad-hoc spacing values outside the 4px grid unless required by component constraints.

## Key component patterns
- Dashboard hero card:
  - Label + title + tenant context.
  - Quick actions on the right.
  - In-context filters (period + site) directly below.
- KPI stat cards:
  - Icon container in top-right.
  - Primary metric with concise hint line.
  - Optional drill-down CTA for direct workflow transition.
- Method performance blocks:
  - Label, success/fail summary, linear conversion bar, and attempts/success rate footer.
- Site performance blocks:
  - Site label + success rate badge + compact three-metric summary.
  - Inline deep link to site-scoped event details.
- Daily traffic table:
  - Compact numeric columns with one load bar column for quick trend scanning.
  - Designed for captive-portal operational checks (attempts, authorizations, vouchers, TOS clicks).
