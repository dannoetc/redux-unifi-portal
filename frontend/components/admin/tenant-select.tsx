"use client";

import { useTenantSelection } from "@/lib/use-tenant";
import { Label } from "@/components/ui/label";

export function TenantSelect() {
  const { tenantId, tenants, setTenantId, loading } = useTenantSelection();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="tenant">Tenant</Label>
        <select
          id="tenant"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={tenantId ?? ""}
          onChange={(event) => setTenantId(event.target.value)}
          disabled={loading || tenants.length === 0}
        >
          {tenants.length === 0 && <option value="">No tenants available</option>}
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
