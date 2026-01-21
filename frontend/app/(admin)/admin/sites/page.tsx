"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontal } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusPill from "@/components/ui/StatusPill";

type Site = {
  id: string;
  slug: string;
  display_name: string;
  enabled: boolean;
  unifi_site_id?: string | null;
};

type SiteList = { sites: Site[] };

type DiscoveredSite = {
  id: string;
  name?: string | null;
  internal_reference?: string | null;
  provisioned: boolean;
  suggested_slug?: string | null;
};

type DiscoveredSiteRow = {
  id: string;
  name: string;
  internalReference: string | null;
  provisioned: boolean;
  selected: boolean;
  slug: string;
  displayName: string;
};

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().optional()
);

const siteSchema = z.object({
  display_name: z.string().min(2),
  slug: z.string().min(2),
  enabled: z.boolean().default(true),
  unifi_base_url: z.string().optional().or(z.literal("")),
  unifi_site_id: z.string().min(1),
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  default_time_limit_minutes: z.coerce.number().min(1),
  default_data_limit_mb: optionalNumber,
  default_rx_kbps: optionalNumber,
  default_tx_kbps: optionalNumber,
});

type CreateSite = z.infer<typeof siteSchema>;

const UNIFI_INTEGRATION_PATH = "/proxy/network/integration";

const normalizeUnifiBaseUrl = (value: string | undefined | null) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (withProtocol.includes(UNIFI_INTEGRATION_PATH)) {
    return withProtocol;
  }
  return `${withProtocol.replace(/\/+$/, "")}${UNIFI_INTEGRATION_PATH}`;
};

export default function SitesPage() {
  const { tenantId, tenants } = useTenantSelection();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverSites, setDiscoverSites] = useState<DiscoveredSiteRow[]>([]);

  const form = useForm<CreateSite>({
    resolver: zodResolver(siteSchema),
    defaultValues: { enabled: true, default_time_limit_minutes: 60 },
  });

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    [tenantId, tenants]
  );
  const tenantSlug = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId)?.slug ?? null,
    [tenantId, tenants]
  );

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

  useEffect(() => {
    if (!discoverOpen || !tenantId) {
      return;
    }
    let active = true;
    setDiscoverLoading(true);
    apiFetch<{ sites: DiscoveredSite[] }>(`/api/admin/tenants/${tenantId}/unifi/sites`)
      .then((data) => {
        if (!active) {
          return;
        }
        const rows = data.sites.map((site) => {
          const displayName = site.name ?? site.internal_reference ?? site.id;
          return {
            id: site.id,
            name: site.name ?? site.id,
            internalReference: site.internal_reference ?? null,
            provisioned: site.provisioned,
            selected: false,
            slug: site.suggested_slug ?? "",
            displayName,
          };
        });
        setDiscoverSites(rows);
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to discover UniFi sites.");
      })
      .finally(() => {
        if (active) {
          setDiscoverLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [discoverOpen, tenantId]);

  const RowActions = ({ site }: { site: Site }) => {
    const [open, setOpen] = useState(false);

    return (
      <details
        className="relative"
        open={open}
        onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary
          aria-label="Open row actions"
          className="flex h-8 w-8 list-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-20 mt-2 min-w-[180px] rounded-md border border-border bg-white p-1 shadow-soft">
          <a
            className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            href={tenantSlug ? `/guest/s/${tenantSlug}/${site.slug}?preview=1` : "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            Preview
          </a>
          <a
            className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            href={`/admin/sites/${site.id}?tenant=${tenantId ?? ""}`}
            onClick={() => setOpen(false)}
          >
            Edit
          </a>
          <div className="my-1 h-px bg-border/70" />
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"
            onClick={() => {
              setSiteToDelete(site);
              setDeleteOpen(true);
              setOpen(false);
            }}
          >
            Remove site
          </button>
        </div>
      </details>
    );
  };

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
        cell: ({ row }) => (
          <StatusPill status={row.original.enabled ? "active" : "inactive"} />
        ),
      },
      {
        accessorKey: "unifi_site_id",
        header: "UniFi Site ID",
        cell: ({ row }) => row.original.unifi_site_id ?? "-",
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <RowActions site={row.original} />
          </div>
        ),
      },
    ],
    [tenantId, tenantSlug]
  );

  const onSubmit = async (values: CreateSite) => {
    if (!tenantId) {
      toast.error("Select a tenant before creating a site.");
      return;
    }
    try {
      const payload = {
        ...values,
        unifi_base_url: normalizeUnifiBaseUrl(values.unifi_base_url),
      };
      const data = await apiFetch<{ site: Site }>(`/api/admin/tenants/${tenantId}/sites`, {
        method: "POST",
        body: JSON.stringify(payload),
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

  const provisionSites = async () => {
    if (!tenantId) {
      return;
    }
    const selected = discoverSites.filter((site) => site.selected && !site.provisioned);
    if (selected.length === 0) {
      toast.error("Select at least one UniFi site to provision.");
      return;
    }
    try {
      const payload = {
        sites: selected.map((site) => ({
          unifi_site_id: site.id,
          slug: site.slug,
          display_name: site.displayName,
        })),
      };
      const data = await apiFetch<{ sites: Site[] }>(`/api/admin/tenants/${tenantId}/sites/provision`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (data.sites.length > 0) {
        setSites((prev) => [...data.sites, ...prev]);
      }
      toast.success("Sites provisioned.");
      setDiscoverOpen(false);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to provision sites.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure branding, policies, and UniFi connection.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="primary" disabled={!tenantId}>
                New site
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create site</DialogTitle>
                <DialogDescription>Add a new UniFi site for the selected tenant.</DialogDescription>
              </DialogHeader>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input id="display_name" autoFocus {...form.register("display_name")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" {...form.register("slug")} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 md:col-span-2">
                  <div>
                    <div className="text-sm font-medium">Site enabled</div>
                    <div className="text-xs text-muted-foreground">Toggle guest access for this site.</div>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={Boolean(form.watch("enabled"))}
                      onChange={() => form.setValue("enabled", !form.getValues("enabled"))}
                    />
                    <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_base_url">UniFi controller IP (optional override)</Label>
                  <Input id="unifi_base_url" placeholder="71.162.143.124" {...form.register("unifi_base_url")} />
                  <p className="text-xs text-muted-foreground">
                    We append {UNIFI_INTEGRATION_PATH} automatically.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_site_id">UniFi site ID</Label>
                  <Input id="unifi_site_id" {...form.register("unifi_site_id")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="unifi_api_key_ref">UniFi API key reference (optional override)</Label>
                  <Input id="unifi_api_key_ref" type="password" placeholder="Use tenant controller" {...form.register("unifi_api_key_ref")} />
                  <p className="text-xs text-muted-foreground">Use a secret reference, not a raw key.</p>
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
                  <Button type="submit" variant="primary">
                    Create site
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" disabled={!tenantId}>
                Discover sites
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Discover UniFi sites</DialogTitle>
                <DialogDescription>Pull sites from the tenant controller and provision them here.</DialogDescription>
              </DialogHeader>
              {discoverLoading ? (
                <div className="text-sm text-muted-foreground">Loading controller sites...</div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid-cols-[80px_1.5fr_1fr_1fr]">
                    <div>Import</div>
                    <div>UniFi Site</div>
                    <div>Slug</div>
                    <div>Display Name</div>
                  </div>
                  <div className="max-h-[360px] space-y-3 overflow-y-auto">
                    {discoverSites.map((site) => (
                      <div
                        key={site.id}
                        className="grid items-center gap-2 rounded-lg border border-border/60 p-3 text-sm md:grid-cols-[80px_1.5fr_1fr_1fr]"
                      >
                        <div>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            disabled={site.provisioned}
                            checked={site.selected}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setDiscoverSites((prev) =>
                                prev.map((item) =>
                                  item.id === site.id ? { ...item, selected: checked } : item
                                )
                              );
                            }}
                          />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{site.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {site.internalReference ?? site.id}
                            {site.provisioned ? " - Already provisioned" : ""}
                          </div>
                        </div>
                        <Input
                          value={site.slug}
                          disabled={site.provisioned}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDiscoverSites((prev) =>
                              prev.map((item) => (item.id === site.id ? { ...item, slug: value } : item))
                            );
                          }}
                        />
                        <Input
                          value={site.displayName}
                          disabled={site.provisioned}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDiscoverSites((prev) =>
                              prev.map((item) =>
                                item.id === site.id ? { ...item, displayName: value } : item
                              )
                            );
                          }}
                        />
                      </div>
                    ))}
                    {discoverSites.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                        No controller sites found.
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="secondary" onClick={() => setDiscoverOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={provisionSites} disabled={discoverLoading}>
                  Provision selected
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3 rounded-lg bg-muted/30 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`site-skeleton-${index}`}
                className="grid animate-pulse grid-cols-[2fr_1fr_1fr_80px] items-center gap-4"
              >
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-8 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/30 p-6">
            <div className="text-sm font-semibold">No sites yet.</div>
            <div className="text-sm text-muted-foreground">
              Create a site or discover sites from the controller.
            </div>
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Create site
            </Button>
          </div>
        ) : (
          <DataTable columns={columns} data={sites} />
        )}
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove site</DialogTitle>
            <DialogDescription>
              This will remove {siteToDelete?.display_name ?? "this site"} and disconnect its portal configuration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
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

