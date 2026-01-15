"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataTable } from "@/components/data-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Site = {
  id: string;
  slug: string;
  display_name: string;
  enabled: boolean;
  unifi_site_id?: string | null;
};

type SiteList = { sites: Site[] };

export default function SitesPage() {
  const { tenantId, tenants, setTenantId, loading: tenantLoading } = useTenantSelection();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setSites([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    apiFetch<SiteList>(`/api/admin/tenants/${tenantId}/sites`)
      .then((data) => {
        if (active) {
          setSites(data.sites);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load sites.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const columns = useMemo<ColumnDef<Site>[]>(
    () => [
      {
        accessorKey: "display_name",
        header: "Site",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.display_name}</div>
            <div className="text-xs text-muted-foreground">{row.original.slug}</div>
          </div>
        ),
      },
      {
        accessorKey: "enabled",
        header: "Status",
        cell: ({ row }) => (row.original.enabled ? "Enabled" : "Disabled"),
      },
      {
        accessorKey: "unifi_site_id",
        header: "UniFi Site ID",
        cell: ({ row }) => row.original.unifi_site_id ?? "-",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            asChild
            variant="outline"
            size="sm"
          >
            <a href={`/admin/sites/${row.original.id}?tenant=${tenantId ?? ""}`}>Edit</a>
          </Button>
        ),
      },
    ],
    [tenantId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure branding, policies, and UniFi connection.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="tenant" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tenant
          </label>
          <select
            id="tenant"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={tenantId ?? ""}
            onChange={(event) => setTenantId(event.target.value)}
            disabled={tenantLoading || tenants.length === 0}
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
      <Card className="p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading sites...</div>
        ) : (
          <DataTable columns={columns} data={sites} />
        )}
      </Card>
    </div>
  );
}
