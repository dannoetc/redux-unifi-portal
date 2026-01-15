export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-grid min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              R
            </div>
            <div>
              <div className="text-sm font-semibold">ReduxTC WiFi</div>
              <div className="text-xs text-muted-foreground">Admin Console</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">MSP-first</div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-[220px_1fr] gap-6 px-6 py-8">
        <aside className="rounded-xl border bg-card p-4 text-sm shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Navigation
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            <li><a className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent" href="/admin">Dashboard</a></li>
            <li><a className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent" href="/admin/tenants">Tenants</a></li>
            <li><a className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent" href="/admin/sites">Sites</a></li>
            <li><a className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent" href="/admin/oidc-providers">OIDC</a></li>
            <li><a className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent" href="/admin/vouchers">Vouchers</a></li>
            <li><a className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent" href="/admin/auth-events">Auth Events</a></li>
          </ul>
        </aside>
        <main className="rounded-xl border bg-card p-6 shadow-soft">{children}</main>
      </div>
    </div>
  );
}
