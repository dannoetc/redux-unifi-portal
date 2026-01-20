"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { apiFetch } from "@/lib/api";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusPill from "@/components/ui/StatusPill";

const schema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  status: z.string().optional(),
  unifi_base_url: z.string().url().optional().or(z.literal("")),
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
});

const controllerSchema = z.object({
  unifi_base_url: z.string().url().optional().or(z.literal("")),
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
});

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  unifi_base_url?: string | null;
  unifi_api_key_ref?: string | null;
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

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [controllerOpen, setControllerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
  const [tenantToConfigure, setTenantToConfigure] = useState<Tenant | null>(null);

  const form = useForm<CreateTenant>({ resolver: zodResolver(schema) });
  const controllerForm = useForm<z.infer<typeof controllerSchema>>({
    resolver: zodResolver(controllerSchema),
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
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusPill status={formatStatus(row.original.status)} />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTenantToConfigure(row.original);
                controllerForm.reset({
                  unifi_base_url: row.original.unifi_base_url ?? "",
                  unifi_api_key_ref: row.original.unifi_api_key_ref ?? "",
                });
                setControllerOpen(true);
              }}
            >
              Configure UniFi
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setTenantToDelete(row.original);
                setDeleteOpen(true);
              }}
            >
              Remove
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const onSubmit = async (values: CreateTenant) => {
    try {
      const data = await apiFetch<{ tenant: Tenant }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(values),
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
      const data = await apiFetch<{ tenant: Tenant }>(`/api/admin/tenants/${tenantToConfigure.id}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      setTenants((prev) =>
        prev.map((tenant) => (tenant.id === data.tenant.id ? data.tenant : tenant))
      );
      toast.success("UniFi controller updated.");
      setControllerOpen(false);
      setTenantToConfigure(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update UniFi controller.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage customer tenants and status.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="primary" className="shadow-sm">
              New tenant
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create tenant</DialogTitle>
              <DialogDescription>Provision a new MSP tenant.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...form.register("name")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" {...form.register("slug")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Input id="status" placeholder="active" {...form.register("status")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_base_url">UniFi controller base URL</Label>
                <Input id="unifi_base_url" placeholder="https://unifi.local" {...form.register("unifi_base_url")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_api_key_ref">UniFi API key reference</Label>
                <Input id="unifi_api_key_ref" {...form.register("unifi_api_key_ref")} />
              </div>
              <DialogFooter>
                <Button type="submit">Create tenant</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="rounded-xl border bg-muted/40 p-6 shadow-soft">
        <h2 className="text-sm font-semibold text-foreground">Provisioning checklist</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Create a tenant and capture the tenant slug.</li>
          <li>2. Add one or more sites with UniFi credentials and default access policy.</li>
          <li>
            3. Set the UniFi external portal URL to{" "}
            <span className="font-medium text-foreground">https://wifi.reduxtc.com/guest/</span>. The
            portal resolves the correct site using the UniFi Network API.
          </li>
        </ul>
      </Card>
      <Card className="rounded-xl border bg-card p-6 shadow-soft">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading tenants...</div>
        ) : (
          <div className="[&_td]:py-2 [&_th]:h-10 [&_th]:text-[11px]">
            <DataTable columns={columns} data={tenants} />
          </div>
        )}
      </Card>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove tenant</DialogTitle>
            <DialogDescription>
              This will permanently remove {tenantToDelete?.name ?? "this tenant"} and all associated data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteTenant} disabled={deleting}>
              {deleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={controllerOpen} onOpenChange={setControllerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>UniFi controller</DialogTitle>
            <DialogDescription>
              Configure the tenant-level UniFi controller used to resolve sites and authorize clients.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={controllerForm.handleSubmit(saveController)}>
            <div className="space-y-2">
              <Label htmlFor="controller_base_url">Base URL</Label>
              <Input id="controller_base_url" {...controllerForm.register("unifi_base_url")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="controller_api_key_ref">API key reference</Label>
              <Input id="controller_api_key_ref" {...controllerForm.register("unifi_api_key_ref")} />
            </div>
            <DialogFooter>
              <Button type="submit">Save controller</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
