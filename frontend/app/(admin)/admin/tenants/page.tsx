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

const schema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  status: z.string().optional(),
});

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status?: string;
};

type TenantList = { tenants: Tenant[] };

type CreateTenant = z.infer<typeof schema>;

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);

  const form = useForm<CreateTenant>({ resolver: zodResolver(schema) });

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
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold uppercase text-emerald-600">
            {row.original.status ?? "active"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage customer tenants and status.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>New tenant</Button>
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
              <DialogFooter>
                <Button type="submit">Create tenant</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Provisioning checklist</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Create a tenant and capture the tenant slug.</li>
          <li>2. Add one or more sites with UniFi credentials and default access policy.</li>
          <li>
            3. Set the UniFi external portal URL to{" "}
            <span className="font-medium text-foreground">
              https://wifi.reduxtc.com/guest/s/&lt;tenant_slug&gt;/&lt;site_slug&gt;/
            </span>
            .
          </li>
        </ul>
      </Card>
      <Card className="p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading tenants...</div>
        ) : (
          <DataTable columns={columns} data={tenants} />
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
    </div>
  );
}
