"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";

export type TenantOption = {
  id: string;
  name: string;
  slug: string;
  status?: string;
};

type AdminMe = {
  admin_user: {
    is_superadmin: boolean;
    memberships: { tenant_id: string; role: string }[];
  };
};

type TenantListResponse = {
  tenants: TenantOption[];
};

export function useTenantSelection() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const me = await apiFetch<AdminMe>("/api/admin/me");
        if (!active) {
          return;
        }
        if (me.admin_user.is_superadmin) {
          const data = await apiFetch<TenantListResponse>("/api/admin/tenants");
          if (!active) {
            return;
          }
          setTenants(data.tenants);
          setTenantId((current) => current ?? data.tenants[0]?.id ?? null);
        } else {
          const firstMembership = me.admin_user.memberships[0];
          if (firstMembership?.tenant_id) {
            setTenantId((current) => current ?? firstMembership.tenant_id);
            setTenants([
              {
                id: firstMembership.tenant_id,
                name: `Tenant ${firstMembership.tenant_id.slice(0, 8)}`,
                slug: firstMembership.tenant_id,
              },
            ]);
          }
        }
      } catch (error: any) {
        toast.error(error?.message ?? "Unable to load tenant info.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return { tenantId, setTenantId, tenants, loading };
}
