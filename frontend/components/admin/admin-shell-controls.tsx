"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";

export function AdminShellControls() {
  const { tenantId, tenants, adminUser } = useTenantSelection();
  const [menuOpen, setMenuOpen] = useState(false);

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId),
    [tenantId, tenants]
  );
  const activeRole = useMemo(() => {
    if (!tenantId || !adminUser?.memberships) {
      return null;
    }
    return adminUser.memberships.find((membership) => membership.tenant_id === tenantId)?.role ?? null;
  }, [adminUser, tenantId]);

  const signOut = async () => {
    try {
      await apiFetch("/api/admin/logout", { method: "POST" });
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to sign out.");
    } finally {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("redux_unifi_portal_tenant_id");
        window.location.href = "/admin/login";
      }
    }
  };

  return (
    <div className="flex items-center justify-end gap-3">
      <details
        className="relative"
        open={menuOpen}
        onToggle={(event) => setMenuOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
          className="flex cursor-pointer list-none items-center gap-3 rounded-full border border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          <Avatar name={adminUser?.email ?? "Admin user"} />
          <div className="hidden flex-col text-left sm:flex">
            <span className="text-xs font-semibold text-foreground">
              {adminUser?.email ?? "Admin user"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {adminUser?.is_superadmin
                ? "Superadmin"
                : activeRole === "TENANT_VIEWER"
                  ? "Tenant viewer"
                  : "Tenant admin"}
              </span>
          </div>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-3 w-3 text-muted-foreground"
            fill="currentColor"
          >
            <path d="M5.5 7.5a1 1 0 0 1 1.4 0L10 10.6l3.1-3.1a1 1 0 1 1 1.4 1.4l-3.8 3.8a1 1 0 0 1-1.4 0L5.5 8.9a1 1 0 0 1 0-1.4Z" />
          </svg>
        </summary>
        <div className="absolute right-0 z-20 mt-2 min-w-[220px] rounded-lg border border-border bg-white p-3 text-xs shadow-soft">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Signed in
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {adminUser?.email ?? "Admin user"}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {adminUser?.is_superadmin
              ? "Superadmin"
              : activeRole === "TENANT_VIEWER"
                ? "Tenant viewer"
                : "Tenant admin"}
          </div>
          {activeTenant ? (
            <div className="mt-3 rounded-md border border-border/60 bg-muted/40 px-2 py-2">
              <div className="text-[11px] uppercase text-muted-foreground">Active tenant</div>
              <div className="text-sm font-medium text-foreground">{activeTenant.name}</div>
              <div className="text-[11px] text-muted-foreground">{activeTenant.slug}</div>
              {activeRole ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Role: {activeRole === "TENANT_ADMIN" ? "Tenant admin" : "Tenant viewer"}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Quick links
            </div>
            <div className="mt-2 grid gap-1 text-sm">
              {adminUser?.is_superadmin ? (
                <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/tenants">
                  Tenants
                </a>
              ) : null}
              {adminUser?.is_superadmin ? (
                <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/admin-users">
                  Admin users
                </a>
              ) : null}
              <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/sites">
                Sites
              </a>
              <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/oidc-providers">
                OIDC
              </a>
              <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/vouchers">
                Vouchers
              </a>
              <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/reports">
                Reports
              </a>
              <a className="rounded-md px-2 py-1 hover:bg-muted" href="/admin/auth-events">
                Auth events
              </a>
            </div>
          </div>
          <div className="mt-3 border-t border-border/60 pt-3">
            <button
              type="button"
              className="w-full rounded-md border border-border px-2 py-1.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
