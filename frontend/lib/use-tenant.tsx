"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

const TENANT_STORAGE_KEY = "redux_unifi_portal_tenant_id";
const TENANT_EVENT = "tenant-selection";

export type TenantOption = {
  id: string;
  name: string;
  slug: string;
  status?: string;
};

type AdminUser = {
  id: string;
  email: string;
  is_superadmin: boolean;
  memberships: { tenant_id: string; role: string }[];
};

type AdminMe = {
  admin_user: AdminUser;
};

type TenantListResponse = {
  tenants: TenantOption[];
};

type TenantResponse = {
  tenant: TenantOption;
};

type SetupStatus = {
  bootstrapped: boolean;
};

export type AdminAppStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "setup-required"
  | "error";

type TenantSelectionContextValue = {
  status: AdminAppStatus;
  errorMessage: string | null;
  tenantId: string | null;
  setTenantId: (tenantId: string | null) => void;
  tenants: TenantOption[];
  loading: boolean;
  adminUser: AdminUser | null;
  isTenantLocked: boolean;
  hasTenants: boolean;
};

const defaultContextValue: TenantSelectionContextValue = {
  status: "loading",
  errorMessage: null,
  tenantId: null,
  setTenantId: () => {},
  tenants: [],
  loading: true,
  adminUser: null,
  isTenantLocked: false,
  hasTenants: false,
};

const TenantSelectionContext = createContext<TenantSelectionContextValue>(defaultContextValue);

const isUnauthorizedError = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

export function TenantSelectionProvider({ children }: { children: React.ReactNode }) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [status, setStatus] = useState<AdminAppStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);

  const tenantIds = useMemo(() => tenants.map((tenant) => tenant.id), [tenants]);

  useEffect(() => {
    let active = true;

    const clearState = (nextStatus: AdminAppStatus, nextErrorMessage: string | null = null) => {
      setAdminUser(null);
      setTenants([]);
      setTenantId(null);
      setErrorMessage(nextErrorMessage);
      setStatus(nextStatus);
    };

    async function load() {
      try {
        setStatus("loading");
        setErrorMessage(null);

        const setupStatus = await apiFetch<SetupStatus>("/api/setup/status");
        if (!active) {
          return;
        }
        if (!setupStatus.bootstrapped) {
          clearState("setup-required");
          return;
        }

        const me = await apiFetch<AdminMe>("/api/admin/me");
        if (!active) {
          return;
        }

        setAdminUser(me.admin_user);

        const storedTenantId =
          typeof window !== "undefined" ? window.localStorage.getItem(TENANT_STORAGE_KEY) : null;

        let tenantList: TenantOption[] = [];
        if (me.admin_user.is_superadmin) {
          const data = await apiFetch<TenantListResponse>("/api/admin/tenants");
          if (!active) {
            return;
          }
          tenantList = data.tenants;
        } else {
          const membershipIds = me.admin_user.memberships.map((membership) => membership.tenant_id);
          if (membershipIds.length > 0) {
            const results = await Promise.all(
              membershipIds.map((id) => apiFetch<TenantResponse>(`/api/admin/tenants/${id}`))
            );
            if (!active) {
              return;
            }
            tenantList = results.map((result) => result.tenant);
          }
        }

        setTenants(tenantList);
        setTenantId((current) => {
          if (current && tenantList.some((tenant) => tenant.id === current)) {
            return current;
          }
          if (storedTenantId && tenantList.some((tenant) => tenant.id === storedTenantId)) {
            return storedTenantId;
          }
          return tenantList[0]?.id ?? null;
        });
        setStatus("authenticated");
      } catch (error: unknown) {
        if (!active) {
          return;
        }
        if (isUnauthorizedError(error)) {
          clearState("unauthenticated");
          return;
        }
        clearState("error", error instanceof Error ? error.message : "Unable to load admin session.");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !tenantId || status !== "authenticated") {
      return;
    }
    window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    window.dispatchEvent(new Event(TENANT_EVENT));
  }, [status, tenantId]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    if (tenantIds.length === 0) {
      if (tenantId !== null) {
        setTenantId(null);
      }
      return;
    }
    if (!tenantId || !tenantIds.includes(tenantId)) {
      setTenantId(tenantIds[0]);
    }
  }, [status, tenantId, tenantIds]);

  useEffect(() => {
    if (typeof window === "undefined" || status !== "authenticated") {
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
  }, [status, tenantId, tenantIds]);

  const value = useMemo<TenantSelectionContextValue>(() => {
    const isTenantLocked = tenants.length === 1;
    const hasTenants = tenants.length > 0;
    return {
      status,
      errorMessage,
      tenantId,
      setTenantId,
      tenants,
      loading: status === "loading",
      adminUser,
      isTenantLocked,
      hasTenants,
    };
  }, [adminUser, errorMessage, status, tenantId, tenants]);

  return (
    <TenantSelectionContext.Provider value={value}>
      {children}
    </TenantSelectionContext.Provider>
  );
}

export function useTenantSelection() {
  return useContext(TenantSelectionContext);
}
