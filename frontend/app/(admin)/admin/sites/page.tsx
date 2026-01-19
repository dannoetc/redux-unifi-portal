"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataTable } from "@/components/data-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Site = {
  id: string;
  slug: string;
  display_name: string;
  enabled: boolean;
  unifi_site_id?: string | null;
};

type SiteList = { sites: Site[] };

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().optional()
);

const siteSchema = z.object({
  display_name: z.string().min(2),
  slug: z.string().min(2),
  enabled: z.boolean().default(true),
  unifi_base_url: z.string().url().optional().or(z.literal("")),
  unifi_site_id: z.string().min(1),
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  default_time_limit_minutes: z.coerce.number().min(1),
  default_data_limit_mb: optionalNumber,
  default_rx_kbps: optionalNumber,
  default_tx_kbps: optionalNumber,
});

type CreateSite = z.infer<typeof siteSchema>;

export default function SitesPage() {
  const { tenantId, tenants, setTenantId, loading: tenantLoading } = useTenantSelection();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);

  const form = useForm<CreateSite>({
    resolver: zodResolver(siteSchema),
    defaultValues: { enabled: true, default_time_limit_minutes: 60 },
  });

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
          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/admin/sites/${row.original.id}?tenant=${tenantId ?? ""}`}>Edit</a>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setSiteToDelete(row.original);
                setDeleteOpen(true);
              }}
            >
              Remove
            </Button>
          </div>
        ),
      },
    ],
    [tenantId]
  );

  const onSubmit = async (values: CreateSite) => {
    if (!tenantId) {
      toast.error("Select a tenant before creating a site.");
      return;
    }
    try {
      const data = await apiFetch<{ site: Site }>(`/api/admin/tenants/${tenantId}/sites`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setSites((prev) => [data.site, ...prev]);
      toast.success("Site created.");
      setDialogOpen(false);
      form.reset();
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create site.");
    }
  };

  const deleteSite = async () => {
    if (!tenantId || !siteToDelete) {
      return;
    }
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/sites/${siteToDelete.id}`, { method: "DELETE" });
      setSites((prev) => prev.filter((site) => site.id !== siteToDelete.id));
      toast.success("Site removed.");
      setDeleteOpen(false);
      setSiteToDelete(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to remove site.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure branding, policies, and UniFi connection.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!tenantId}>New site</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create site</DialogTitle>
                <DialogDescription>Add a new UniFi site for the selected tenant.</DialogDescription>
              </DialogHeader>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input id="display_name" {...form.register("display_name")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" {...form.register("slug")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_base_url">UniFi base URL (optional override)</Label>
                  <Input id="unifi_base_url" placeholder="Use tenant controller" {...form.register("unifi_base_url")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_site_id">UniFi site ID</Label>
                  <Input id="unifi_site_id" {...form.register("unifi_site_id")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="unifi_api_key_ref">UniFi API key reference (optional override)</Label>
                  <Input id="unifi_api_key_ref" placeholder="Use tenant controller" {...form.register("unifi_api_key_ref")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_time_limit_minutes">Time limit (minutes)</Label>
                  <Input id="default_time_limit_minutes" type="number" {...form.register("default_time_limit_minutes")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_data_limit_mb">Data limit (MB)</Label>
                  <Input id="default_data_limit_mb" type="number" {...form.register("default_data_limit_mb")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_rx_kbps">RX limit (kbps)</Label>
                  <Input id="default_rx_kbps" type="number" {...form.register("default_rx_kbps")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_tx_kbps">TX limit (kbps)</Label>
                  <Input id="default_tx_kbps" type="number" {...form.register("default_tx_kbps")} />
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-muted-foreground">
                    Once created, open the site to configure branding and run the UniFi connectivity test.
                  </p>
                </div>
                <DialogFooter className="md:col-span-2">
                  <Button type="submit">Create site</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card className="p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading sites...</div>
        ) : (
          <DataTable columns={columns} data={sites} />
        )}
      </Card>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove site</DialogTitle>
            <DialogDescription>
              This will remove {siteToDelete?.display_name ?? "this site"} and disconnect its portal configuration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteSite} disabled={deleting}>
              {deleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
