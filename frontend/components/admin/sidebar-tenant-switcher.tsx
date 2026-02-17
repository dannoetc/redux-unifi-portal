"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Building2 } from "lucide-react";

import TenantSwitcher from "@/components/TenantSwitcher";
import { useTenantSelection } from "@/lib/use-tenant";
import { Button } from "@/components/ui/button";

type SidebarTenantSwitcherProps = {
  collapsed?: boolean;
  onExpand?: () => void;
};

export function SidebarTenantSwitcher({ collapsed = false, onExpand }: SidebarTenantSwitcherProps) {
  const { tenantId, setTenantId, tenants, loading, isTenantLocked } = useTenantSelection();
  const options = useMemo(
    () => tenants.map((tenant) => ({ label: tenant.name, value: tenant.id })),
    [tenants]
  );

  if (collapsed) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-center rounded-md border border-border/60 bg-background px-2 py-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label="Select tenant"
        title="Select tenant"
        onClick={onExpand}
      >
        <Building2 className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  if (!loading && options.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-dashed border-border/70 bg-muted/20 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tenant</p>
        <p className="text-xs text-muted-foreground">No tenants</p>
        <Button asChild size="sm" variant="secondary" className="h-8 w-full">
          <Link href="/admin/tenants?onboarding=1">Create tenant</Link>
        </Button>
      </div>
    );
  }

  if (isTenantLocked && options.length === 1) {
    return (
      <div className="space-y-2">
        <p className="block text-[11px] uppercase tracking-wide text-muted-foreground">
          Tenant
        </p>
        <div
          id="tenant-lock"
          className="w-full rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm font-medium text-foreground"
        >
          {options[0].label}
        </div>
      </div>
    );
  }

  return (
    <TenantSwitcher
      value={tenantId ?? ""}
      options={options}
      emptyLabel={loading ? "Loading tenants..." : "No tenants"}
      disabled={loading}
      className="space-y-2"
      onChange={(value) => {
        if (!loading) {
          setTenantId(value);
        }
      }}
    />
  );
}
