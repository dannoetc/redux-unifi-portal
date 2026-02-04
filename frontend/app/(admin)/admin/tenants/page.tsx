"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import StatusPill from "@/components/ui/StatusPill";

const optionalPort = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "number" && Number.isNaN(value)) {
      return undefined;
    }
    return value;
  },
  z.number().int().positive().optional()
);

const schema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  status: z.string().optional(),
  unifi_base_url: z.string().optional().or(z.literal("")),
  unifi_port: optionalPort,
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  unifi_api_key: z.string().optional().or(z.literal("")),
});

const controllerSchema = z.object({
  unifi_base_url: z.string().optional().or(z.literal("")),
  unifi_port: optionalPort,
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  unifi_api_key: z.string().optional().or(z.literal("")),
});

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  unifi_base_url?: string | null;
  unifi_api_key_ref?: string | null;
  unifi_api_key_stored?: boolean | null;
};

type TenantList = { tenants: Tenant[] };

type CreateTenant = z.infer<typeof schema>;

const formatStatus = (status?: string) => {
  const normalized = (status ?? "ACTIVE").toLowerCase();
  if (normalized === "active") {
    return "active";
  }
  if (normalized === "suspended" || normalized === "inactive") {
    return "inactive";
  }
  return "unknown";
};

const UNIFI_INTEGRATION_PATH = "/proxy/network/integration";
const DEFAULT_UNIFI_PORT = 443;

const parseUnifiHostAndPort = (value?: string | null) => {
  if (!value) {
    return { host: "", port: DEFAULT_UNIFI_PORT };
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    const parsedPort = url.port ? Number(url.port) : DEFAULT_UNIFI_PORT;
    return {
      host: url.hostname,
      port: Number.isNaN(parsedPort) ? DEFAULT_UNIFI_PORT : parsedPort,
    };
  } catch {
    return { host: value, port: DEFAULT_UNIFI_PORT };
  }
};

const applyUnifiPort = (value: string | undefined | null, port: number | undefined) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const { host, port: parsedPort } = parseUnifiHostAndPort(trimmed);
  const resolvedPort = port ?? parsedPort;
  if (!resolvedPort || resolvedPort === DEFAULT_UNIFI_PORT) {
    return host;
  }
  return `${host}:${resolvedPort}`;
};

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

const displayUnifiHost = (value?: string | null) => {
  return parseUnifiHostAndPort(value).host;
};

const displayUnifiPort = (value?: string | null) => {
  return parseUnifiHostAndPort(value).port;
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [controllerOpen, setControllerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
  const [tenantToConfigure, setTenantToConfigure] = useState<Tenant | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupInitialized, setSetupInitialized] = useState(false);

  const form = useForm<CreateTenant>({
    resolver: zodResolver(schema),
    defaultValues: { status: "ACTIVE", unifi_port: DEFAULT_UNIFI_PORT, unifi_api_key: "" },
  });
  const controllerForm = useForm<z.infer<typeof controllerSchema>>({
    resolver: zodResolver(controllerSchema),
    defaultValues: {
      unifi_port: DEFAULT_UNIFI_PORT,
      unifi_api_key: "",
    },
  });

  useEffect(() => {
    let active = true;
    apiFetch<TenantList>("/api/admin/tenants")
      .then((data) => {
        if (active) {
          setTenants(data.tenants);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load tenants.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!setupInitialized && !loading) {
      setSetupOpen(tenants.length === 0);
      setSetupInitialized(true);
    }
  }, [loading, setupInitialized, tenants.length]);

  const RowActions = ({ tenant }: { tenant: Tenant }) => {
    return (
      <PopoverMenu
        trigger={
          <button
            type="button"
            aria-label="Open row actions"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      >
        <PopoverMenuItem
          onClick={() => {
            setTenantToConfigure(tenant);
            const { host, port } = parseUnifiHostAndPort(tenant.unifi_base_url);
            controllerForm.reset({
              unifi_base_url: host,
              unifi_port: port,
              unifi_api_key_ref: tenant.unifi_api_key_ref ?? "",
              unifi_api_key: "",
            });
            setControllerOpen(true);
          }}
        >
          Configure UniFi
        </PopoverMenuItem>
        <PopoverMenuSeparator />
        <PopoverMenuItem
          className="text-destructive"
          onClick={() => {
            setTenantToDelete(tenant);
            setDeleteOpen(true);
          }}
        >
          Remove tenant
        </PopoverMenuItem>
      </PopoverMenu>
    );
  };

  const columns = useMemo<ColumnDef<Tenant>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="font-medium text-foreground">{row.original.name}</div>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        meta: { hiddenOnMobile: true },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.slug}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { hiddenOnMobile: true },
        cell: ({ row }) => (
          <StatusPill status={formatStatus(row.original.status)} />
        ),
      },
      {
        id: "details",
        header: () => <span className="md:hidden">Details</span>,
        meta: { showOnMobileOnly: true, headerClassName: "text-xs" },
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground md:hidden">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Slug</span>
              <span>{row.original.slug}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Status</span>
              <StatusPill status={formatStatus(row.original.status)} />
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <RowActions tenant={row.original} />
          </div>
        ),
      },
    ],
    []
  );

  const onSubmit = async (values: CreateTenant) => {
    try {
      const { unifi_port, ...rest } = values;
      const unifiHost = applyUnifiPort(values.unifi_base_url, unifi_port);
      const payload = {
        ...rest,
        status: values.status ?? "ACTIVE",
        unifi_base_url: normalizeUnifiBaseUrl(unifiHost),
        unifi_api_key_ref: values.unifi_api_key_ref || undefined,
        unifi_api_key: values.unifi_api_key?.trim() ? values.unifi_api_key : undefined,
      };
      const data = await apiFetch<{ tenant: Tenant }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setTenants((prev) => [data.tenant, ...prev]);
      toast.success("Tenant created.");
      setDialogOpen(false);
      form.reset();
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create tenant.");
    }
  };

  const deleteTenant = async () => {
    if (!tenantToDelete) {
      return;
    }
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/tenants/${tenantToDelete.id}`, { method: "DELETE" });
      setTenants((prev) => prev.filter((tenant) => tenant.id !== tenantToDelete.id));
      toast.success("Tenant removed.");
      setDeleteOpen(false);
      setTenantToDelete(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to remove tenant.");
    } finally {
      setDeleting(false);
    }
  };

  const saveController = async (values: z.infer<typeof controllerSchema>) => {
    if (!tenantToConfigure) {
      return;
    }

    try {
      const unifiHost = applyUnifiPort(values.unifi_base_url, values.unifi_port);
      const payload = {
        unifi_base_url: normalizeUnifiBaseUrl(unifiHost),
        unifi_api_key_ref: values.unifi_api_key_ref || undefined,
        unifi_api_key: values.unifi_api_key?.trim() ? values.unifi_api_key : undefined,
      };
      const data = await apiFetch<{ tenant: Tenant }>(`/api/admin/tenants/${tenantToConfigure.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setTenants((prev) =>
        prev.map((tenant) => (tenant.id === data.tenant.id ? data.tenant : tenant))
      );
      toast.success("Tenant networking updated.");
      setControllerOpen(false);
      setTenantToConfigure(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update UniFi controller.");
    }
  };

  const testController = async () => {
    if (!tenantToConfigure) {
      return;
    }
    try {
      const data = await apiFetch<{ sites: Array<{ id: string }> }>(
        `/api/admin/tenants/${tenantToConfigure.id}/unifi/sites`
      );
      const count = data.sites?.length ?? 0;
      toast.success(`UniFi connection verified (${count} site${count === 1 ? "" : "s"} found).`);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to reach UniFi controller.");
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-104px)] w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage customer tenants and status.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="primary" className="shadow-sm">
              New tenant
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create tenant</DialogTitle>
              <DialogDescription>Provision a new MSP tenant.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" autoFocus {...form.register("name")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" {...form.register("slug")} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">Toggle tenant access.</div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={form.watch("status") !== "SUSPENDED"}
                    onChange={() =>
                      form.setValue(
                        "status",
                        form.watch("status") === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"
                      )
                    }
                  />
                  <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                  <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_base_url">UniFi controller IP</Label>
                <Input
                  id="unifi_base_url"
                  placeholder="71.162.143.124"
                  {...form.register("unifi_base_url")}
                />
                <p className="text-xs text-muted-foreground">
                  We append {UNIFI_INTEGRATION_PATH} automatically.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_port">UniFi controller port</Label>
                <Input
                  id="unifi_port"
                  type="number"
                  min={1}
                  max={65535}
                  {...form.register("unifi_port", { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">Defaults to {DEFAULT_UNIFI_PORT}.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_api_key">UniFi API key</Label>
                <Input id="unifi_api_key" type="password" {...form.register("unifi_api_key")} />
                <p className="text-xs text-muted-foreground">Stored encrypted in the database.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_api_key_ref">UniFi API key reference (optional)</Label>
                <Input id="unifi_api_key_ref" type="password" {...form.register("unifi_api_key_ref")} />
                <p className="text-xs text-muted-foreground">Legacy env var name (overridden by stored key).</p>
              </div>
              <DialogFooter>
                <Button type="submit" variant="primary">
                  Create tenant
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <details
        className="group rounded-lg bg-muted/30 p-4"
        open={setupOpen}
        onToggle={(event) => setSetupOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white">
          Setup checklist
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Create a tenant and capture the tenant slug.</li>
          <li>2. Add one or more sites with UniFi credentials and default access policy.</li>
          <li>
            3. In the UniFi console, set the external portal host/IP to{" "}
            <span className="font-medium text-foreground">wifi.reduxtc.com</span> (hostnames only). The
            portal resolves the correct site using the UniFi Network API.
          </li>
        </ul>
      </details>
      <section className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`tenant-skeleton-${index}`}
                className="grid animate-pulse grid-cols-[2fr_1fr_1fr_80px] items-center gap-4"
              >
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-8 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border/60 bg-background/80 p-6">
            <div className="text-sm font-semibold">No tenants yet.</div>
            <div className="text-sm text-muted-foreground">
              Create your first tenant to start provisioning sites.
            </div>
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Create tenant
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-visible rounded-lg border border-border/60 bg-background">
            <DataTable columns={columns} data={tenants} />
          </div>
        )}
      </section>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove tenant</DialogTitle>
            <DialogDescription>
              This will permanently remove {tenantToDelete?.name ?? "this tenant"} and all associated data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteTenant} disabled={deleting}>
              {deleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={controllerOpen} onOpenChange={setControllerOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tenant networking</DialogTitle>
            <DialogDescription>
              Configure the tenant-level UniFi controller connection.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={controllerForm.handleSubmit(saveController)}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="controller_base_url">UniFi controller IP</Label>
                <Input
                  id="controller_base_url"
                  placeholder="71.162.143.124"
                  {...controllerForm.register("unifi_base_url")}
                />
                <p className="text-xs text-muted-foreground">
                  We append {UNIFI_INTEGRATION_PATH} automatically.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="controller_port">UniFi controller port</Label>
                <Input
                  id="controller_port"
                  type="number"
                  min={1}
                  max={65535}
                  {...controllerForm.register("unifi_port", { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">Defaults to {DEFAULT_UNIFI_PORT}.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="controller_api_key">UniFi API key</Label>
                <Input id="controller_api_key" type="password" {...controllerForm.register("unifi_api_key")} />
                <p className="text-xs text-muted-foreground">
                  {tenantToConfigure?.unifi_api_key_stored
                    ? "Encrypted key is stored. Leave blank to keep the current value."
                    : "Stored encrypted in the database."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="controller_api_key_ref">API key reference (optional)</Label>
                <Input
                  id="controller_api_key_ref"
                  type="password"
                  {...controllerForm.register("unifi_api_key_ref")}
                />
                <p className="text-xs text-muted-foreground">Legacy env var name (overridden by stored key).</p>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={testController}>
                Test UniFi connection
              </Button>
              <Button type="submit" variant="primary">
                Save settings
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
