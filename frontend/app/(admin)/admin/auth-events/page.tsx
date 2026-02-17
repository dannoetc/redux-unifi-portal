"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ApiError, apiDownloadCsv, apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataErrorState, TenantOnboardingState, TenantSelectionState } from "@/components/admin/page-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthEvent = {
  id: string;
  site_id: string;
  method: string;
  result: string;
  reason?: string | null;
  created_at: string;
  portal_session_id?: string | null;
  guest_identity_id?: string | null;
};

type PaginationMeta = {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
};
type AuthEventResponse = { events: AuthEvent[]; pagination?: PaginationMeta };

type Site = {
  id: string;
  display_name: string;
};

type SiteList = { sites: Site[] };

type Filters = {
  method: string;
  result: string;
  search: string;
  siteId: string;
};

type TenantScope = "selected" | "all";

const METHOD_OPTIONS = ["voucher", "email_otp", "oidc", "tos_only"] as const;
const RESULT_OPTIONS = ["success", "fail"] as const;

function parseInitialFilters(searchParams: URLSearchParams): Filters {
  const method = searchParams.get("method") ?? "";
  const result = searchParams.get("result") ?? "";
  return {
    method: METHOD_OPTIONS.includes(method as (typeof METHOD_OPTIONS)[number]) ? method : "",
    result: RESULT_OPTIONS.includes(result as (typeof RESULT_OPTIONS)[number]) ? result : "",
    search: searchParams.get("search") ?? "",
    siteId: searchParams.get("site_id") ?? "",
  };
}

function parseInitialScope(searchParams: URLSearchParams): TenantScope {
  return searchParams.get("scope") === "all" ? "all" : "selected";
}

function parseInitialPage(searchParams: URLSearchParams): number {
  const parsed = Number(searchParams.get("page") ?? "1");
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return 1;
}

function parseInitialPageSize(searchParams: URLSearchParams): number {
  const parsed = Number(searchParams.get("page_size") ?? "50");
  if ([25, 50, 100].includes(parsed)) {
    return parsed;
  }
  return 50;
}

function filtersEqual(a: Filters, b: Filters) {
  return (
    a.method === b.method &&
    a.result === b.result &&
    a.search === b.search &&
    a.siteId === b.siteId
  );
}

function AuthEventsPageContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const { tenantId, tenants, adminUser, loading: tenantLoading } = useTenantSelection();
  const initialFilters = useMemo(
    () => parseInitialFilters(new URLSearchParams(searchParamString)),
    [searchParamString]
  );
  const initialScope = useMemo(
    () => parseInitialScope(new URLSearchParams(searchParamString)),
    [searchParamString]
  );
  const initialPage = useMemo(
    () => parseInitialPage(new URLSearchParams(searchParamString)),
    [searchParamString]
  );
  const initialPageSize = useMemo(
    () => parseInitialPageSize(new URLSearchParams(searchParamString)),
    [searchParamString]
  );
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteLoadError, setSiteLoadError] = useState<string | null>(null);
  const [eventsLoadError, setEventsLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [tenantScope, setTenantScope] = useState<TenantScope>(initialScope);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [totalEvents, setTotalEvents] = useState(0);
  const pageResetInitializedRef = useRef(false);
  const activeTenant = tenants.find((tenant) => tenant.id === tenantId) ?? null;

  const canUseAllTenants = Boolean(adminUser?.is_superadmin && tenants.length > 1);
  const noTenants = !tenantLoading && tenants.length === 0;
  const viewingAllTenants = canUseAllTenants && tenantScope === "all";
  const hasScope = viewingAllTenants || Boolean(tenantId);

  const siteLookup = useMemo(
    () => new Map(sites.map((site) => [site.id, site.display_name])),
    [sites]
  );

  useEffect(() => {
    setFilters((current) => (filtersEqual(current, initialFilters) ? current : initialFilters));
  }, [initialFilters]);

  useEffect(() => {
    setTenantScope((current) => (current === initialScope ? current : initialScope));
  }, [initialScope]);

  useEffect(() => {
    setPage((current) => (current === initialPage ? current : initialPage));
  }, [initialPage]);

  useEffect(() => {
    setPageSize((current) => (current === initialPageSize ? current : initialPageSize));
  }, [initialPageSize]);

  useEffect(() => {
    if (!canUseAllTenants && tenantScope !== "selected") {
      setTenantScope("selected");
    }
  }, [canUseAllTenants, tenantScope]);

  useEffect(() => {
    if (filters.siteId && sites.length > 0 && !sites.some((site) => site.id === filters.siteId)) {
      setFilters((prev) => ({ ...prev, siteId: "" }));
    }
  }, [filters.siteId, sites]);

  useEffect(() => {
    if (!pageResetInitializedRef.current) {
      pageResetInitializedRef.current = true;
      return;
    }
    setPage(1);
  }, [filters.method, filters.result, filters.search, filters.siteId, tenantScope]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.method) params.set("method", filters.method);
    if (filters.result) params.set("result", filters.result);
    if (filters.search) params.set("search", filters.search);
    if (filters.siteId) params.set("site_id", filters.siteId);
    if (viewingAllTenants) params.set("scope", "all");
    if (page > 1) params.set("page", String(page));
    if (pageSize !== 50) params.set("page_size", String(pageSize));
    const nextQuery = params.toString();
    const currentQuery = searchParamString;
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [filters, page, pageSize, pathname, router, searchParamString, viewingAllTenants]);

  useEffect(() => {
    if (!hasScope) {
      setSites([]);
      setSiteLoadError(null);
      setFilters((prev) => ({ ...prev, siteId: "" }));
      return;
    }

    let active = true;
    setSiteLoadError(null);
    const endpoint = viewingAllTenants ? "/api/admin/sites/options" : `/api/admin/tenants/${tenantId}/sites`;
    apiFetch<SiteList>(endpoint)
      .then((data) => {
        if (!active) {
          return;
        }
        setSites(data.sites);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/admin/login");
          return;
        }
        const message = error?.message ?? "Unable to load sites.";
        setSiteLoadError(message);
        toast.error(message);
      });

    return () => {
      active = false;
    };
  }, [hasScope, reloadToken, router, tenantId, viewingAllTenants]);

  useEffect(() => {
    if (!hasScope) {
      setEvents([]);
      setTotalEvents(0);
      setEventsLoadError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setEventsLoadError(null);
    const params = new URLSearchParams();
    if (filters.method) params.set("method", filters.method);
    if (filters.result) params.set("result", filters.result);
    if (filters.search) params.set("search", filters.search);
    if (filters.siteId) params.set("site_id", filters.siteId);
    params.set("limit", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));

    const endpoint = viewingAllTenants
      ? `/api/admin/auth-events?${params.toString()}`
      : `/api/admin/tenants/${tenantId}/auth-events?${params.toString()}`;

    apiFetch<AuthEventResponse>(endpoint)
      .then((data) => {
        if (active) {
          setEvents(data.events);
          setTotalEvents(data.pagination?.total ?? data.events.length);
        }
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/admin/login");
          return;
        }
        const message = error?.message ?? "Unable to load auth events.";
        setEventsLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [filters, hasScope, page, pageSize, reloadToken, router, tenantId, viewingAllTenants]);

  useEffect(() => {
    if (totalEvents === 0) {
      return;
    }
    const maxPage = Math.max(1, Math.ceil(totalEvents / pageSize));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, pageSize, totalEvents]);

  const columns = useMemo<ColumnDef<AuthEvent>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Timestamp",
        cell: ({ row }) => new Date(row.original.created_at).toLocaleString(),
      },
      {
        id: "site",
        header: "Site",
        cell: ({ row }) => siteLookup.get(row.original.site_id) ?? row.original.site_id,
      },
      {
        accessorKey: "method",
        header: "Method",
      },
      {
        accessorKey: "result",
        header: "Result",
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ row }) => row.original.reason ?? "-",
      },
    ],
    [siteLookup]
  );

  const exportCsv = async () => {
    if (!hasScope) {
      return;
    }
    const params = new URLSearchParams();
    if (filters.method) params.set("method", filters.method);
    if (filters.result) params.set("result", filters.result);
    if (filters.search) params.set("search", filters.search);
    if (filters.siteId) params.set("site_id", filters.siteId);

    try {
      const suffix = params.toString();
      const endpoint = viewingAllTenants
        ? `/api/admin/auth-events/export.csv${suffix ? `?${suffix}` : ""}`
        : `/api/admin/tenants/${tenantId}/auth-events/export.csv${suffix ? `?${suffix}` : ""}`;
      await apiDownloadCsv(endpoint, "auth-events.csv");
      toast.success("CSV exported.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to export events.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Auth events</h1>
          <p className="mt-1 text-sm text-muted-foreground">Audit guest authentications across sites.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {viewingAllTenants
              ? "Scope: all tenants"
              : activeTenant
                ? `Active tenant: ${activeTenant.name}`
                : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!hasScope}>
          Export CSV
        </Button>
        <Button
          variant="secondary"
          onClick={() => setReloadToken((current) => current + 1)}
          disabled={!hasScope || loading}
        >
          Refresh
        </Button>
      </div>

      {canUseAllTenants ? (
        <div className="inline-flex rounded-lg border border-border/80 bg-background/80 p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              !viewingAllTenants ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTenantScope("selected")}
          >
            Selected tenant
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              viewingAllTenants ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTenantScope("all")}
          >
            All tenants
          </button>
        </div>
      ) : null}

      {noTenants ? (
        <TenantOnboardingState />
      ) : !hasScope ? (
        <TenantSelectionState message="Select a tenant to view auth events." />
      ) : (
        <Card className="rounded-xl border bg-card p-6 shadow-soft">
          {siteLoadError ? (
            <div className="mb-4">
              <DataErrorState
                compact
                title="Unable to load site options."
                message={siteLoadError}
                onRetry={() => setReloadToken((current) => current + 1)}
              />
            </div>
          ) : null}
          <div className="space-y-4">
            <div className="grid gap-4 rounded-lg bg-muted/30 p-4 md:grid-cols-5">
              <div className="space-y-2">
                <Label htmlFor="method">Method</Label>
                <select
                  id="method"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={filters.method}
                  onChange={(event) => setFilters((prev) => ({ ...prev, method: event.target.value }))}
                >
                  <option value="">All</option>
                  <option value="voucher">Voucher</option>
                  <option value="email_otp">Email OTP</option>
                  <option value="oidc">OIDC</option>
                  <option value="tos_only">TOS only</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="result">Result</Label>
                <select
                  id="result"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={filters.result}
                  onChange={(event) => setFilters((prev) => ({ ...prev, result: event.target.value }))}
                >
                  <option value="">All</option>
                  <option value="success">Success</option>
                  <option value="fail">Fail</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="site">Site</Label>
                <select
                  id="site"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={filters.siteId}
                  onChange={(event) => setFilters((prev) => ({ ...prev, siteId: event.target.value }))}
                >
                  <option value="">All sites</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="search">Search</Label>
                <Input
                  id="search"
                  placeholder="Portal session or guest"
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                />
              </div>
            </div>
          </div>
          <div className="mt-4">
            {eventsLoadError ? (
              <DataErrorState
                compact
                title="Unable to load auth events."
                message={eventsLoadError}
                onRetry={() => setReloadToken((current) => current + 1)}
              />
            ) : loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`events-skeleton-${index}`}
                    className="grid animate-pulse grid-cols-[1.2fr_1fr_1fr_2fr] items-center gap-4"
                  >
                    <div className="h-4 rounded bg-muted/60" />
                    <div className="h-4 rounded bg-muted/60" />
                    <div className="h-4 rounded bg-muted/60" />
                    <div className="h-4 rounded bg-muted/60" />
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/30 p-4">
                <div className="text-sm font-semibold">No auth events yet.</div>
                <div className="text-sm text-muted-foreground">
                  Successful voucher, OTP, and OIDC activity will appear here.
                </div>
              </div>
            ) : (
              <DataTable columns={columns} data={events} enablePagination={false} />
            )}
          </div>
          {!loading && totalEvents > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">
                Showing {Math.min((page - 1) * pageSize + 1, totalEvents)}-
                {Math.min(page * pageSize, totalEvents)} of {totalEvents.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="auth_events_page_size" className="text-xs text-muted-foreground">
                  Rows
                </Label>
                <select
                  id="auth_events_page_size"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <div className="min-w-16 text-center text-xs text-muted-foreground">
                  Page {page}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page * pageSize >= totalEvents}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}

export default function AuthEventsPage() {
  return (
    <Suspense fallback={<div className="space-y-6 text-sm text-muted-foreground">Loading auth events...</div>}>
      <AuthEventsPageContent />
    </Suspense>
  );
}
