"use client";

import { useMemo } from "react";
import { Building2 } from "lucide-react";

import TenantSwitcher from "@/components/TenantSwitcher";
import { useTenantSelection } from "@/lib/use-tenant";

type SidebarTenantSwitcherProps = {
  collapsed?: boolean;
  onExpand?: () => void;
};

export function SidebarTenantSwitcher({ collapsed = false, onExpand }: SidebarTenantSwitcherProps) {
  const { tenantId, setTenantId, tenants, loading } = useTenantSelection();
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

  return (
    <TenantSwitcher
      value={tenantId ?? ""}
      options={options}
      className="space-y-2"
      onChange={(value) => {
        if (!loading) {
          setTenantId(value);
        }
      }}
    />
  );
}
