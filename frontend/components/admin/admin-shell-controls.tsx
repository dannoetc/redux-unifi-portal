"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";

const TENANT_STORAGE_KEY = "redux_unifi_portal_tenant_id";

const getInitials = (email?: string | null) => {
  if (!email) {
    return "AD";
  }
  const name = email.split("@")[0] ?? "";
  const trimmed = name.replace(/[^a-zA-Z0-9]/g, "");
  return (trimmed.slice(0, 2) || "AD").toUpperCase();
};

export function AdminShellControls() {
  const { tenantId, setTenantId, tenants, loading, adminUser } = useTenantSelection();
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = useMemo(() => getInitials(adminUser?.email), [adminUser?.email]);
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
  const canManageTenant = adminUser?.is_superadmin || activeRole === "TENANT_ADMIN";

  const signOut = async () => {
    try {
      await apiFetch("/api/admin/logout", { method: "POST" });
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to sign out.");
    } finally {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(TENANT_STORAGE_KEY);
        window.location.href = "/admin/login";
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tenant
        </span>
        <select
          className="h-9 min-w-[160px] rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          value={tenantId ?? ""}
          onChange={(event) => setTenantId(event.target.value)}
          disabled={loading || tenants.length <= 1}
          aria-label="Tenant switcher"
        >
          {tenants.length === 0 ? (
            <option value="">No tenants</option>
          ) : null}
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </div>
      <details
        className="relative"
        open={menuOpen}
        onToggle={(event) => setMenuOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {initials}
          </span>
          <span className="hidden text-xs text-foreground sm:inline">
            {adminUser?.email ?? "Admin user"}
          </span>
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-border bg-white p-3 text-xs shadow-soft">
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
              {canManageTenant ? (
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
