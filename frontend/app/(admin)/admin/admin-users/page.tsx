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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const adminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["TENANT_ADMIN", "TENANT_VIEWER"]),
});

const updateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["TENANT_ADMIN", "TENANT_VIEWER"]),
  is_superadmin: z.boolean(),
  password: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(8).optional()
  ),
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
type UpdateAdmin = z.infer<typeof updateSchema>;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
};

export default function AdminUsersPage() {
  const { tenantId, tenants, adminUser } = useTenantSelection();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adminToDelete, setAdminToDelete] = useState<AdminUser | null>(null);
  const [adminToEdit, setAdminToEdit] = useState<AdminUser | null>(null);

  const form = useForm<CreateAdmin>({
    resolver: zodResolver(adminSchema),
    defaultValues: { role: "TENANT_ADMIN" },
  });
  const editForm = useForm<UpdateAdmin>({
    resolver: zodResolver(updateSchema),
    defaultValues: { role: "TENANT_ADMIN", is_superadmin: false },
  });

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    [tenantId, tenants]
  );
  const canManageUsers = adminUser?.is_superadmin ?? false;
  const adminLoaded = adminUser !== null;

  useEffect(() => {
    if (!tenantId || !adminUser) {
      if (adminLoaded && !tenantId) {
        setAdmins([]);
        setLoading(false);
      }
      return;
    }
    if (!canManageUsers) {
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
  }, [tenantId, adminUser, adminLoaded, canManageUsers]);

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
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
            {row.original.is_superadmin ? "Superadmin" : row.original.role.replace("_", " ")}
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
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAdminToEdit(row.original);
                editForm.reset({
                  email: row.original.email,
                  role: row.original.role as UpdateAdmin["role"],
                  is_superadmin: row.original.is_superadmin,
                  password: "",
                });
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={row.original.is_superadmin}
              onClick={() => {
                setAdminToDelete(row.original);
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

  const updateAdmin = async (values: UpdateAdmin) => {
    if (!tenantId || !adminToEdit) {
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<UpdateAdmin> & { password?: string } = {
        email: values.email,
        role: values.role,
        is_superadmin: values.is_superadmin,
      };
      if (values.password) {
        payload.password = values.password;
      }
      const data = await apiFetch<{ admin: AdminUser }>(
        `/api/admin/tenants/${tenantId}/admins/${adminToEdit.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
      setAdmins((prev) =>
        prev.map((admin) => (admin.id === data.admin.id ? data.admin : admin))
      );
      toast.success("Admin updated.");
      setEditOpen(false);
      setAdminToEdit(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update admin.");
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-semibold">Admin users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Provision tenant-scoped admin access.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="primary" disabled={!tenantId || !canManageUsers}>
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
      <Card className="rounded-xl border bg-card p-6 shadow-soft">
        {!canManageUsers && adminLoaded ? (
          <div className="text-sm text-muted-foreground">
            Only superadmins can manage admin users.
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`admin-skeleton-${index}`}
                className="grid animate-pulse grid-cols-[2fr_1fr_1fr_120px] items-center gap-4"
              >
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-8 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : admins.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/30 p-4">
            <div className="text-sm font-semibold">No admins yet.</div>
            <div className="text-sm text-muted-foreground">
              Create the first admin for this tenant.
            </div>
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Create admin
            </Button>
          </div>
        ) : (
          <DataTable columns={columns} data={admins} />
        )}
      </Card>
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
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit admin</DialogTitle>
            <DialogDescription>Update email, role, or platform access.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={editForm.handleSubmit(updateAdmin)}>
            <div className="space-y-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input id="edit_email" type="email" autoFocus {...editForm.register("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_password">Reset password</Label>
              <Input id="edit_password" type="password" {...editForm.register("password")} />
              <p className="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_role">Role</Label>
              <select
                id="edit_role"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
                {...editForm.register("role")}
              >
                <option value="TENANT_ADMIN">Tenant admin</option>
                <option value="TENANT_VIEWER">Tenant viewer</option>
              </select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Superadmin access</div>
                <div className="text-xs text-muted-foreground">Grant platform-wide permissions.</div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={Boolean(editForm.watch("is_superadmin"))}
                  onChange={() => editForm.setValue("is_superadmin", !editForm.getValues("is_superadmin"))}
                />
                <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
              </label>
            </div>
            <DialogFooter>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
