"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { apiDownloadCsv, apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
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

type Filters = {
  method: string;
  result: string;
  search: string;
};

export default function AuthEventsPage() {
  const { tenantId, tenants } = useTenantSelection();
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ method: "", result: "", search: "" });
  const activeTenant = tenants.find((tenant) => tenant.id === tenantId) ?? null;

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
    []
  );

  const exportCsv = async () => {
    if (!tenantId) {
      return;
    }
    try {
      await apiDownloadCsv(`/api/admin/tenants/${tenantId}/auth-events/export.csv`, "auth-events.csv");
      toast.success("CSV exported.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to export events.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Auth events</h1>
          <p className="mt-1 text-sm text-muted-foreground">Audit guest authentications across sites.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <div className="space-y-4">
        <div className="grid gap-4 rounded-lg bg-muted/30 p-4 md:grid-cols-4">
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
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              placeholder="Portal session or guest"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
          </div>
        </div>
        {loading ? (
          <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
            Loading auth events...
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-lg bg-muted/30 p-6 text-sm text-muted-foreground">
            No auth events yet.
          </div>
        ) : (
          <DataTable columns={columns} data={events} />
        )}
      </div>
    </div>
  );
}
