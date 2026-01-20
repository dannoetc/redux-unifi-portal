"use client";

import { useMemo } from "react";

import TenantSwitcher from "@/components/TenantSwitcher";
import { useTenantSelection } from "@/lib/use-tenant";

export function SidebarTenantSwitcher() {
  const { tenantId, setTenantId, tenants, loading } = useTenantSelection();
  const options = useMemo(
    () => tenants.map((tenant) => ({ label: tenant.name, value: tenant.id })),
    [tenants]
  );

  return (
    <TenantSwitcher
      value={tenantId ?? ""}
      options={options}
      onChange={(value) => {
        if (!loading) {
          setTenantId(value);
        }
      }}
    />
  );
}
