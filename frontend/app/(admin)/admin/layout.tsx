export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <div className="text-sm font-semibold">ReduxTC WiFi</div>
          <div className="text-xs text-muted-foreground">Admin</div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-[240px_1fr] gap-6 p-6">
        <aside className="rounded-lg border p-3 text-sm">
          <div className="font-medium">Navigation</div>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a className="hover:underline" href="/admin">Dashboard</a></li>
            <li><a className="hover:underline" href="/admin/tenants">Tenants</a></li>
            <li><a className="hover:underline" href="/admin/sites">Sites</a></li>
            <li><a className="hover:underline" href="/admin/auth-events">Auth Events</a></li>
          </ul>
        </aside>
        <main className="rounded-lg border bg-white p-6">{children}</main>
      </div>
    </div>
  );
}
