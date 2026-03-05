"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { TenantOnboardingState } from "@/components/admin/page-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const tenantAdminCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["TENANT_ADMIN", "TENANT_VIEWER"]),
});

const tenantAdminUpdateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["TENANT_ADMIN", "TENANT_VIEWER"]),
  password: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(8).optional()
  ),
});

const superadminCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const superadminUpdateSchema = z.object({
  email: z.string().email(),
  password: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(8).optional()
  ),
});

type TenantAdminUser = {
  id: string;
  email: string;
  role: string;
  is_superadmin: boolean;
  created_at: string;
};

type SuperadminUser = {
  id: string;
  email: string;
  is_superadmin: boolean;
  created_at: string;
};

type TenantAdminList = { admins: TenantAdminUser[] };
type SuperadminList = { superadmins: SuperadminUser[] };

type TenantAdminCreate = z.infer<typeof tenantAdminCreateSchema>;
type TenantAdminUpdate = z.infer<typeof tenantAdminUpdateSchema>;
type SuperadminCreate = z.infer<typeof superadminCreateSchema>;
type SuperadminUpdate = z.infer<typeof superadminUpdateSchema>;

type AdminTab = "tenant_admins" | "superadmins";

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
};

export default function AdminUsersPage() {
  const { tenantId, tenants, adminUser, loading: tenantLoading } = useTenantSelection();
  const [tenantAdmins, setTenantAdmins] = useState<TenantAdminUser[]>([]);
  const [superadmins, setSuperadmins] = useState<SuperadminUser[]>([]);
  const [tenantAdminsLoading, setTenantAdminsLoading] = useState(true);
  const [superadminsLoading, setSuperadminsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>("tenant_admins");

  const [tenantCreateOpen, setTenantCreateOpen] = useState(false);
  const [tenantEditOpen, setTenantEditOpen] = useState(false);
  const [tenantDeleteOpen, setTenantDeleteOpen] = useState(false);
  const [superCreateOpen, setSuperCreateOpen] = useState(false);
  const [superEditOpen, setSuperEditOpen] = useState(false);
  const [superDeleteOpen, setSuperDeleteOpen] = useState(false);

  const [tenantSaving, setTenantSaving] = useState(false);
  const [tenantDeleting, setTenantDeleting] = useState(false);
  const [superSaving, setSuperSaving] = useState(false);
  const [superDeleting, setSuperDeleting] = useState(false);

  const [tenantAdminToDelete, setTenantAdminToDelete] = useState<TenantAdminUser | null>(null);
  const [tenantAdminToEdit, setTenantAdminToEdit] = useState<TenantAdminUser | null>(null);
  const [superadminToDelete, setSuperadminToDelete] = useState<SuperadminUser | null>(null);
  const [superadminToEdit, setSuperadminToEdit] = useState<SuperadminUser | null>(null);

  const tenantCreateForm = useForm<TenantAdminCreate>({
    resolver: zodResolver(tenantAdminCreateSchema),
    defaultValues: { role: "TENANT_ADMIN" },
  });
  const tenantEditForm = useForm<TenantAdminUpdate>({
    resolver: zodResolver(tenantAdminUpdateSchema),
    defaultValues: { role: "TENANT_ADMIN" },
  });
  const superCreateForm = useForm<SuperadminCreate>({
    resolver: zodResolver(superadminCreateSchema),
  });
  const superEditForm = useForm<SuperadminUpdate>({
    resolver: zodResolver(superadminUpdateSchema),
  });

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    [tenantId, tenants]
  );
  const canManageUsers = adminUser?.is_superadmin ?? false;
  const adminLoaded = adminUser !== null;
  const noTenants = !tenantLoading && tenants.length === 0;

  useEffect(() => {
    if (!canManageUsers || !adminLoaded) {
      return;
    }
    setActiveTab("superadmins");
  }, [adminLoaded, canManageUsers]);

  useEffect(() => {
    if (!tenantId || !adminUser) {
      if (adminLoaded && !tenantId) {
        setTenantAdmins([]);
        setTenantAdminsLoading(false);
      }
      return;
    }
    if (!canManageUsers) {
      setTenantAdmins([]);
      setTenantAdminsLoading(false);
      return;
    }
    let active = true;
    setTenantAdminsLoading(true);
    apiFetch<TenantAdminList>(`/api/admin/tenants/${tenantId}/admins`)
      .then((data) => {
        if (active) {
          setTenantAdmins(data.admins);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load tenant admins.");
      })
      .finally(() => {
        if (active) {
          setTenantAdminsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [tenantId, adminUser, adminLoaded, canManageUsers]);

  useEffect(() => {
    if (!adminUser) {
      if (adminLoaded) {
        setSuperadmins([]);
        setSuperadminsLoading(false);
      }
      return;
    }
    if (!canManageUsers) {
      setSuperadmins([]);
      setSuperadminsLoading(false);
      return;
    }
    let active = true;
    setSuperadminsLoading(true);
    apiFetch<SuperadminList>("/api/admin/superadmins")
      .then((data) => {
        if (active) {
          setSuperadmins(data.superadmins);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load superadmins.");
      })
      .finally(() => {
        if (active) {
          setSuperadminsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [adminUser, adminLoaded, canManageUsers]);

  const tenantColumns = useMemo<ColumnDef<TenantAdminUser>[]>(
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
                setTenantAdminToEdit(row.original);
                tenantEditForm.reset({
                  email: row.original.email,
                  role: row.original.role as TenantAdminUpdate["role"],
                  password: "",
                });
                setTenantEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={row.original.is_superadmin}
              onClick={() => {
                setTenantAdminToDelete(row.original);
                setTenantDeleteOpen(true);
              }}
            >
              Remove
            </Button>
          </div>
        ),
      },
    ],
    [tenantEditForm]
  );

  const superColumns = useMemo<ColumnDef<SuperadminUser>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="font-medium text-foreground">{row.original.email}</div>
        ),
      },
      {
        id: "scope",
        header: "Scope",
        cell: () => (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
            Platform
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
        cell: ({ row }) => {
          const isCurrentUser = row.original.id === adminUser?.id;
          return (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSuperadminToEdit(row.original);
                  superEditForm.reset({
                    email: row.original.email,
                    password: "",
                  });
                  setSuperEditOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isCurrentUser}
                onClick={() => {
                  setSuperadminToDelete(row.original);
                  setSuperDeleteOpen(true);
                }}
              >
                Remove
              </Button>
            </div>
          );
        },
      },
    ],
    [adminUser?.id, superEditForm]
  );

  const createTenantAdmin = async (values: TenantAdminCreate) => {
    if (!tenantId) {
      toast.error("Select a tenant before creating an admin.");
      return;
    }
    try {
      const data = await apiFetch<{ admin: TenantAdminUser }>(`/api/admin/tenants/${tenantId}/admins`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setTenantAdmins((prev) => [data.admin, ...prev]);
      toast.success("Tenant admin created.");
      setTenantCreateOpen(false);
      tenantCreateForm.reset({ role: "TENANT_ADMIN", email: "", password: "" });
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create tenant admin.");
    }
  };

  const updateTenantAdmin = async (values: TenantAdminUpdate) => {
    if (!tenantId || !tenantAdminToEdit) {
      return;
    }
    setTenantSaving(true);
    try {
      const payload: Partial<TenantAdminUpdate> & { password?: string } = {
        email: values.email,
        role: values.role,
      };
      if (values.password) {
        payload.password = values.password;
      }
      const data = await apiFetch<{ admin: TenantAdminUser }>(
        `/api/admin/tenants/${tenantId}/admins/${tenantAdminToEdit.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
      setTenantAdmins((prev) =>
        prev.map((admin) => (admin.id === data.admin.id ? data.admin : admin))
      );
      toast.success("Tenant admin updated.");
      setTenantEditOpen(false);
      setTenantAdminToEdit(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update tenant admin.");
    } finally {
      setTenantSaving(false);
    }
  };

  const deleteTenantAdmin = async () => {
    if (!tenantId || !tenantAdminToDelete) {
      return;
    }
    setTenantDeleting(true);
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/admins/${tenantAdminToDelete.id}`, { method: "DELETE" });
      setTenantAdmins((prev) => prev.filter((admin) => admin.id !== tenantAdminToDelete.id));
      toast.success("Tenant admin removed.");
      setTenantDeleteOpen(false);
      setTenantAdminToDelete(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to remove tenant admin.");
    } finally {
      setTenantDeleting(false);
    }
  };

  const createSuperadmin = async (values: SuperadminCreate) => {
    try {
      const data = await apiFetch<{ superadmin: SuperadminUser }>("/api/admin/superadmins", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setSuperadmins((prev) => [data.superadmin, ...prev]);
      toast.success("Superadmin created.");
      setSuperCreateOpen(false);
      superCreateForm.reset({ email: "", password: "" });
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create superadmin.");
    }
  };

  const updateSuperadmin = async (values: SuperadminUpdate) => {
    if (!superadminToEdit) {
      return;
    }
    setSuperSaving(true);
    try {
      const payload: Partial<SuperadminUpdate> & { password?: string } = {
        email: values.email,
      };
      if (values.password) {
        payload.password = values.password;
      }
      const data = await apiFetch<{ superadmin: SuperadminUser }>(
        `/api/admin/superadmins/${superadminToEdit.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
      setSuperadmins((prev) =>
        prev.map((admin) => (admin.id === data.superadmin.id ? data.superadmin : admin))
      );
      toast.success("Superadmin updated.");
      setSuperEditOpen(false);
      setSuperadminToEdit(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update superadmin.");
    } finally {
      setSuperSaving(false);
    }
  };

  const deleteSuperadmin = async () => {
    if (!superadminToDelete) {
      return;
    }
    setSuperDeleting(true);
    try {
      await apiFetch(`/api/admin/superadmins/${superadminToDelete.id}`, { method: "DELETE" });
      setSuperadmins((prev) => prev.filter((admin) => admin.id !== superadminToDelete.id));
      toast.success("Superadmin removed.");
      setSuperDeleteOpen(false);
      setSuperadminToDelete(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to remove superadmin.");
    } finally {
      setSuperDeleting(false);
    }
  };

  const tabButtonClass = (tab: AdminTab) =>
    `rounded-md px-3 py-2 text-sm font-medium transition ${
      activeTab === tab
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    }`;

  const showTenantTab = activeTab === "tenant_admins";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage tenant admins and platform superadmins.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-border/70 bg-muted/20 p-1">
            <button type="button" className={tabButtonClass("superadmins")} onClick={() => setActiveTab("superadmins")}>
              Superadmins
            </button>
            <button type="button" className={tabButtonClass("tenant_admins")} onClick={() => setActiveTab("tenant_admins")}>
              Tenant admins
            </button>
          </div>

          {showTenantTab ? (
            <Dialog open={tenantCreateOpen} onOpenChange={setTenantCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="primary" disabled={!tenantId || !canManageUsers}>
                  New tenant admin
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create tenant admin</DialogTitle>
                  <DialogDescription>Invite a new admin for the selected tenant.</DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={tenantCreateForm.handleSubmit(createTenantAdmin)}>
                  <div className="space-y-2">
                    <Label htmlFor="tenant_admin_email">Email</Label>
                    <Input id="tenant_admin_email" type="email" autoFocus {...tenantCreateForm.register("email")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant_admin_password">Temporary password</Label>
                    <Input id="tenant_admin_password" type="password" {...tenantCreateForm.register("password")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant_admin_role">Role</Label>
                    <select
                      id="tenant_admin_role"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      {...tenantCreateForm.register("role")}
                    >
                      <option value="TENANT_ADMIN">Tenant admin</option>
                      <option value="TENANT_VIEWER">Tenant viewer</option>
                    </select>
                  </div>
                  <DialogFooter>
                    <Button type="submit" variant="primary">
                      Create tenant admin
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={superCreateOpen} onOpenChange={setSuperCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="primary" disabled={!canManageUsers}>
                  New superadmin
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Create superadmin</DialogTitle>
                  <DialogDescription>Grant full platform access to a new superadmin.</DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={superCreateForm.handleSubmit(createSuperadmin)}>
                  <div className="space-y-2">
                    <Label htmlFor="superadmin_email">Email</Label>
                    <Input id="superadmin_email" type="email" autoFocus {...superCreateForm.register("email")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="superadmin_password">Password</Label>
                    <Input id="superadmin_password" type="password" {...superCreateForm.register("password")} />
                  </div>
                  <DialogFooter>
                    <Button type="submit" variant="primary">
                      Create superadmin
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card className="rounded-xl border bg-card p-6 shadow-soft">
        {!canManageUsers && adminLoaded ? (
          <div className="text-sm text-muted-foreground">
            Only superadmins can manage admin users.
          </div>
        ) : showTenantTab ? (
          noTenants ? (
            <TenantOnboardingState compact description="Create a tenant before managing tenant admins." />
          ) : tenantAdminsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`tenant-admin-skeleton-${index}`}
                  className="grid animate-pulse grid-cols-[2fr_1fr_1fr_120px] items-center gap-4"
                >
                  <div className="h-4 rounded bg-muted/60" />
                  <div className="h-4 rounded bg-muted/60" />
                  <div className="h-4 rounded bg-muted/60" />
                  <div className="h-8 rounded bg-muted/60" />
                </div>
              ))}
            </div>
          ) : tenantAdmins.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/30 p-4">
              <div className="text-sm font-semibold">No tenant admins yet.</div>
              <div className="text-sm text-muted-foreground">
                Create the first admin for this tenant.
              </div>
              <Button variant="primary" onClick={() => setTenantCreateOpen(true)}>
                Create tenant admin
              </Button>
            </div>
          ) : (
            <DataTable columns={tenantColumns} data={tenantAdmins} />
          )
        ) : superadminsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`superadmin-skeleton-${index}`}
                className="grid animate-pulse grid-cols-[2fr_1fr_1fr_120px] items-center gap-4"
              >
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-8 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : superadmins.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/30 p-4">
            <div className="text-sm font-semibold">No superadmins found.</div>
            <div className="text-sm text-muted-foreground">
              Create a superadmin to grant platform-wide access.
            </div>
            <Button variant="primary" onClick={() => setSuperCreateOpen(true)}>
              Create superadmin
            </Button>
          </div>
        ) : (
          <DataTable columns={superColumns} data={superadmins} />
        )}
      </Card>

      <Dialog open={tenantDeleteOpen} onOpenChange={setTenantDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove tenant admin</DialogTitle>
            <DialogDescription>
              This will remove tenant access for {tenantAdminToDelete?.email ?? "this admin"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setTenantDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteTenantAdmin} disabled={tenantDeleting}>
              {tenantDeleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tenantEditOpen} onOpenChange={setTenantEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit tenant admin</DialogTitle>
            <DialogDescription>Update email, role, or reset password.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={tenantEditForm.handleSubmit(updateTenantAdmin)}>
            <div className="space-y-2">
              <Label htmlFor="edit_tenant_email">Email</Label>
              <Input id="edit_tenant_email" type="email" autoFocus {...tenantEditForm.register("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_tenant_password">Reset password</Label>
              <Input id="edit_tenant_password" type="password" {...tenantEditForm.register("password")} />
              <p className="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_tenant_role">Role</Label>
              <select
                id="edit_tenant_role"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                {...tenantEditForm.register("role")}
              >
                <option value="TENANT_ADMIN">Tenant admin</option>
                <option value="TENANT_VIEWER">Tenant viewer</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" variant="primary" disabled={tenantSaving}>
                {tenantSaving ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={superDeleteOpen} onOpenChange={setSuperDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove superadmin</DialogTitle>
            <DialogDescription>
              This permanently removes platform access for {superadminToDelete?.email ?? "this superadmin"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setSuperDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteSuperadmin} disabled={superDeleting}>
              {superDeleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={superEditOpen} onOpenChange={setSuperEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit superadmin</DialogTitle>
            <DialogDescription>Update email or reset superadmin password.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={superEditForm.handleSubmit(updateSuperadmin)}>
            <div className="space-y-2">
              <Label htmlFor="edit_super_email">Email</Label>
              <Input id="edit_super_email" type="email" autoFocus {...superEditForm.register("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_super_password">Reset password</Label>
              <Input id="edit_super_password" type="password" {...superEditForm.register("password")} />
              <p className="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
            </div>
            <DialogFooter>
              <Button type="submit" variant="primary" disabled={superSaving}>
                {superSaving ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

