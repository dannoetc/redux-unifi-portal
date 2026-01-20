import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="surface-grid min-h-screen px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="rounded-2xl border bg-white/90 p-8 shadow-soft backdrop-blur sm:p-10">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">ReduxTC WiFi</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-4xl md:text-5xl">
            Unified captive portal for UniFi
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Guest traffic lands at an external portal with session handoff while admins manage tenants, sites,
            vouchers, and OIDC from a UniFi-adjacent console.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant="primary">
              <a href="/admin">Open admin console</a>
            </Button>
            <Button asChild variant="secondary">
              <a href="/guest/s/demo/main">Preview guest portal</a>
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex h-full flex-col rounded-xl border bg-card p-6 shadow-soft">
            <div className="text-sm font-semibold">Guest flows</div>
            <p className="mt-auto text-sm text-muted-foreground">
              Voucher, email OTP, and OIDC SSO.
            </p>
          </div>
          <div className="flex h-full flex-col rounded-xl border bg-card p-6 shadow-soft">
            <div className="text-sm font-semibold">Tenant scoping</div>
            <p className="mt-auto text-sm text-muted-foreground">
              Tenant-to-site boundaries everywhere.
            </p>
          </div>
          <div className="flex h-full flex-col rounded-xl border bg-card p-6 shadow-soft">
            <div className="text-sm font-semibold">Export-ready</div>
            <p className="mt-auto text-sm text-muted-foreground">
              CSV exports for vouchers and auth events.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

