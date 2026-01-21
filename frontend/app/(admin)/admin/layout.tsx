import { AdminShellControls } from "@/components/admin/admin-shell-controls";
import { SidebarTenantSwitcher } from "@/components/admin/sidebar-tenant-switcher";
import { SidebarNav } from "@/components/admin/sidebar-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-grid min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-6 lg:px-8">
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
      <div className="mx-auto grid max-w-7xl grid-cols-[220px_1fr] gap-6 px-5 py-8 sm:px-6 lg:grid-cols-[240px_1fr] lg:px-8">
        <aside className="rounded-xl bg-white/70 p-4 text-sm shadow-sm ring-1 ring-border/40">
          <SidebarTenantSwitcher />
          <div className="mb-2 mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">
            Navigation
          </div>
          <SidebarNav />
        </aside>
        <main className="rounded-xl bg-white p-6 shadow-sm">{children}</main>
      </div>
    </div>
  );
}
