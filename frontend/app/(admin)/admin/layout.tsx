import { AdminShellControls } from "@/components/admin/admin-shell-controls";
import { SidebarTenantSwitcher } from "@/components/admin/sidebar-tenant-switcher";
import { SidebarNav } from "@/components/admin/sidebar-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-grid min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              aria-hidden="true"
            >
              R
            </div>
            <div>
              <div className="text-sm font-semibold">ReduxTC WiFi</div>
              <div className="text-xs text-muted-foreground">Admin Console</div>
            </div>
          </div>
          <AdminShellControls />
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-[220px_1fr] gap-6 px-6 py-8">
        <aside className="rounded-xl border bg-card p-4 text-sm shadow-soft">
          <SidebarTenantSwitcher />
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Navigation
          </div>
          <SidebarNav />
        </aside>
        <main className="rounded-xl border bg-card p-6 shadow-soft">{children}</main>
      </div>
    </div>
  );
}
