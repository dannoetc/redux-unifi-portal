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

const adminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["TENANT_ADMIN", "TENANT_VIEWER"]),
});

type AdminUser = {
  id: string;
  email: string;
  role: string;
  is_superadmin: boolean;
  created_at: string;
};

type AdminList = { admins: AdminUser[] };

type CreateAdmin = z.infer<typeof adminSchema>;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
};

export default function AdminUsersPage() {
  const { tenantId, tenants } = useTenantSelection();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adminToDelete, setAdminToDelete] = useState<AdminUser | null>(null);

  const form = useForm<CreateAdmin>({
    resolver: zodResolver(adminSchema),
    defaultValues: { role: "TENANT_ADMIN" },
  });

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    [tenantId, tenants]
  );

  useEffect(() => {
    if (!tenantId) {
      setAdmins([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    apiFetch<AdminList>(`/api/admin/tenants/${tenantId}/admins`)
      .then((data) => {
        if (active) {
          setAdmins(data.admins);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load admins.");
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

  const RowActions = ({ admin }: { admin: AdminUser }) => {
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
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"
            onClick={() => {
              setAdminToDelete(admin);
              setDeleteOpen(true);
              setOpen(false);
            }}
          >
            Remove admin
          </button>
        </div>
      </details>
    );
  };

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="font-medium text-foreground">{row.original.email}</div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            {row.original.role.replace("_", " ")}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Added",
        cell: ({ row }) => formatDate(row.original.created_at),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <RowActions admin={row.original} />
          </div>
        ),
      },
    ],
    []
  );

  const onSubmit = async (values: CreateAdmin) => {
    if (!tenantId) {
      toast.error("Select a tenant before creating an admin.");
      return;
    }
    try {
      const data = await apiFetch<{ admin: AdminUser }>(`/api/admin/tenants/${tenantId}/admins`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setAdmins((prev) => [data.admin, ...prev]);
      toast.success("Admin user created.");
      setDialogOpen(false);
      form.reset({ role: "TENANT_ADMIN", email: "", password: "" });
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create admin user.");
    }
  };

  const deleteAdmin = async () => {
    if (!tenantId || !adminToDelete) {
      return;
    }
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/admins/${adminToDelete.id}`, { method: "DELETE" });
      setAdmins((prev) => prev.filter((admin) => admin.id !== adminToDelete.id));
      toast.success("Admin removed.");
      setDeleteOpen(false);
      setAdminToDelete(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to remove admin.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Admin users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Provision tenant-scoped admin access.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="primary" disabled={!tenantId}>
                New admin
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create admin user</DialogTitle>
                <DialogDescription>Invite a new admin for the selected tenant.</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoFocus {...form.register("email")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Temporary password</Label>
                  <Input id="password" type="password" {...form.register("password")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <select
                    id="role"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    {...form.register("role")}
                  >
                    <option value="TENANT_ADMIN">Tenant admin</option>
                    <option value="TENANT_VIEWER">Tenant viewer</option>
                  </select>
                </div>
                <DialogFooter>
                  <Button type="submit" variant="primary">
                    Create admin
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="space-y-4">
        {loading ? (
          <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
            Loading admins...
          </div>
        ) : admins.length === 0 ? (
          <div className="rounded-lg bg-muted/30 p-6 text-sm text-muted-foreground">
            No admins yet.
          </div>
        ) : (
          <DataTable columns={columns} data={admins} />
        )}
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove admin</DialogTitle>
            <DialogDescription>
              This will remove access for {adminToDelete?.email ?? "this admin"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteAdmin} disabled={deleting}>
              {deleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
