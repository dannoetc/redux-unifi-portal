"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { apiDownloadCsv, apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
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

type AuthEventResponse = { events: AuthEvent[] };

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
  const { tenantId, tenants } = useTenantSelection();
  const initialFilters = useMemo(
    () => parseInitialFilters(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const activeTenant = tenants.find((tenant) => tenant.id === tenantId) ?? null;

  const siteLookup = useMemo(
    () => new Map(sites.map((site) => [site.id, site.display_name])),
    [sites]
  );

  const filteredEvents = useMemo(
    () => (filters.siteId ? events.filter((event) => event.site_id === filters.siteId) : events),
    [events, filters.siteId]
  );

  useEffect(() => {
    setFilters((current) => (filtersEqual(current, initialFilters) ? current : initialFilters));
  }, [initialFilters]);

  useEffect(() => {
    if (filters.siteId && sites.length > 0 && !sites.some((site) => site.id === filters.siteId)) {
      setFilters((prev) => ({ ...prev, siteId: "" }));
    }
  }, [filters.siteId, sites]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.method) params.set("method", filters.method);
    if (filters.result) params.set("result", filters.result);
    if (filters.search) params.set("search", filters.search);
    if (filters.siteId) params.set("site_id", filters.siteId);
    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [filters, pathname, router, searchParams]);

  useEffect(() => {
    if (!tenantId) {
      setSites([]);
      setFilters((prev) => ({ ...prev, siteId: "" }));
      return;
    }

    let active = true;
    apiFetch<SiteList>(`/api/admin/tenants/${tenantId}/sites`)
      .then((data) => {
        if (!active) {
          return;
        }
        setSites(data.sites);
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load sites.");
      });

    return () => {
      active = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.method) params.set("method", filters.method);
    if (filters.result) params.set("result", filters.result);
    if (filters.search) params.set("search", filters.search);
    if (filters.siteId) params.set("site_id", filters.siteId);

    apiFetch<AuthEventResponse>(`/api/admin/tenants/${tenantId}/auth-events?${params.toString()}`)
      .then((data) => {
        if (active) {
          setEvents(data.events);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load auth events.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [tenantId, filters]);

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
    if (!tenantId) {
      return;
    }
    const params = new URLSearchParams();
    if (filters.method) params.set("method", filters.method);
    if (filters.result) params.set("result", filters.result);
    if (filters.search) params.set("search", filters.search);
    if (filters.siteId) params.set("site_id", filters.siteId);

    try {
      const suffix = params.toString();
      await apiDownloadCsv(
        `/api/admin/tenants/${tenantId}/auth-events/export.csv${suffix ? `?${suffix}` : ""}`,
        "auth-events.csv"
      );
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
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <Card className="rounded-xl border bg-card p-6 shadow-soft">
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
          {loading ? (
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
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/30 p-4">
              <div className="text-sm font-semibold">No auth events yet.</div>
              <div className="text-sm text-muted-foreground">
                Successful voucher, OTP, and OIDC activity will appear here.
              </div>
            </div>
          ) : (
            <DataTable columns={columns} data={filteredEvents} />
          )}
        </div>
      </Card>
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
