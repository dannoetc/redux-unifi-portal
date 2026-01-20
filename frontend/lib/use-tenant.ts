"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";

const TENANT_STORAGE_KEY = "redux_unifi_portal_tenant_id";
const TENANT_EVENT = "tenant-selection";

export type TenantOption = {
  id: string;
  name: string;
  slug: string;
  status?: string;
};

type AdminMe = {
  admin_user: {
    email: string;
    is_superadmin: boolean;
    memberships: { tenant_id: string; role: string }[];
  };
};

type TenantListResponse = {
  tenants: TenantOption[];
};

type TenantResponse = {
  tenant: TenantOption;
};

export function useTenantSelection() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminUser, setAdminUser] = useState<AdminMe["admin_user"] | null>(null);

  const tenantIds = useMemo(() => tenants.map((tenant) => tenant.id), [tenants]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const me = await apiFetch<AdminMe>("/api/admin/me");
        if (!active) {
          return;
        }
        setAdminUser(me.admin_user);
        const storedTenantId =
          typeof window !== "undefined" ? window.localStorage.getItem(TENANT_STORAGE_KEY) : null;
        if (me.admin_user.is_superadmin) {
          const data = await apiFetch<TenantListResponse>("/api/admin/tenants");
          if (!active) {
            return;
          }
          setTenants(data.tenants);
          const preferred =
            storedTenantId && data.tenants.find((tenant) => tenant.id === storedTenantId)
              ? storedTenantId
              : data.tenants[0]?.id ?? null;
          setTenantId((current) => current ?? preferred);
        } else {
          const membershipIds = me.admin_user.memberships.map((membership) => membership.tenant_id);
          if (membershipIds.length > 0) {
            const results = await Promise.all(
              membershipIds.map((id) => apiFetch<TenantResponse>(`/api/admin/tenants/${id}`))
            );
            if (!active) {
              return;
            }
            const tenantList = results.map((result) => result.tenant);
            setTenants(tenantList);
            const preferred =
              storedTenantId && membershipIds.includes(storedTenantId)
                ? storedTenantId
                : membershipIds[0] ?? null;
            setTenantId((current) => current ?? preferred);
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

  useEffect(() => {
    if (typeof window === "undefined" || !tenantId) {
      return;
    }
    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    window.dispatchEvent(new Event(TENANT_EVENT));
  }, [tenantId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncFromStorage = () => {
      const stored = window.localStorage.getItem(TENANT_STORAGE_KEY);
      if (!stored || stored === tenantId || !tenantIds.includes(stored)) {
        return;
      }
      setTenantId(stored);
    };
    window.addEventListener(TENANT_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(TENANT_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, [tenantId, tenantIds]);

  return { tenantId, setTenantId, tenants, loading, adminUser };
}
