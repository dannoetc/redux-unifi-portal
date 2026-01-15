export default function Home() {
  return (
    <main className="surface-grid min-h-screen px-6 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border bg-white/90 p-8 shadow-soft backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">ReduxTC WiFi</p>
          <h1 className="mt-3 text-3xl font-semibold">MSP-first UniFi captive portal</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Guest traffic lands at the external portal with session handoff, while admins manage
            tenants, sites, vouchers, and OIDC policy from a UniFi-adjacent console.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <a className="rounded-md border border-input bg-background px-4 py-2 hover:bg-accent" href="/admin">
              Open admin console
            </a>
            <a className="rounded-md border border-input bg-background px-4 py-2 hover:bg-accent" href="/guest/s/demo/main">
              Preview guest portal
            </a>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-sm font-medium">Guest flows</div>
            <p className="mt-1 text-xs text-muted-foreground">Voucher, email OTP, and OIDC SSO.</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-sm font-medium">MSP scoping</div>
            <p className="mt-1 text-xs text-muted-foreground">Tenant → site boundaries everywhere.</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-sm font-medium">Export-ready</div>
            <p className="mt-1 text-xs text-muted-foreground">CSV exports for vouchers and auth events.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
