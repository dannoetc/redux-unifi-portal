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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  issuer: z.string().url(),
  client_id: z.string().min(2),
  client_secret_ref: z.string().optional().or(z.literal("")),
  scopes: z.string().optional().or(z.literal("")),
});

type Provider = {
  id: string;
  issuer: string;
  client_id: string;
  client_secret_ref?: string | null;
  scopes?: string | null;
};

type ProviderList = { providers: Provider[] };

type ProviderCreate = z.infer<typeof schema>;

export default function OidcProvidersPage() {
  const { tenantId, tenants } = useTenantSelection();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<ProviderCreate>({ resolver: zodResolver(schema) });
  const activeTenant = tenants.find((tenant) => tenant.id === tenantId) ?? null;

  useEffect(() => {
    if (!tenantId) {
      setProviders([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    apiFetch<ProviderList>(`/api/admin/tenants/${tenantId}/oidc-providers`)
      .then((data) => {
        if (active) {
          setProviders(data.providers);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load OIDC providers.");
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

  const columns = useMemo<ColumnDef<Provider>[]>(
    () => [
      {
        accessorKey: "issuer",
        header: "Issuer",
        cell: ({ row }) => <div className="font-medium">{row.original.issuer}</div>,
      },
      {
        accessorKey: "client_id",
        header: "Client ID",
      },
      {
        accessorKey: "scopes",
        header: "Scopes",
        cell: ({ row }) => row.original.scopes ?? "openid email profile",
      },
    ],
    []
  );

  const onSubmit = async (values: ProviderCreate) => {
    if (!tenantId) {
      return;
    }
    try {
      const data = await apiFetch<{ provider: Provider }>(
        `/api/admin/tenants/${tenantId}/oidc-providers`,
        {
          method: "POST",
          body: JSON.stringify(values),
        }
      );
      setProviders((prev) => [data.provider, ...prev]);
      toast.success("OIDC provider created.");
      setDialogOpen(false);
      form.reset();
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create provider.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">OIDC providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tenant-wide SSO definitions.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeTenant ? `Active tenant: ${activeTenant.name}` : "Select a tenant from the sidebar to continue."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="primary">New provider</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create OIDC provider</DialogTitle>
                <DialogDescription>Configure issuer + client credentials.</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <Label htmlFor="issuer">Issuer URL</Label>
                  <Input id="issuer" autoFocus placeholder="https://login.example.com" {...form.register("issuer")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client_id">Client ID</Label>
                  <Input id="client_id" {...form.register("client_id")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client_secret_ref">Client secret ref</Label>
                  <Input id="client_secret_ref" type="password" {...form.register("client_secret_ref")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scopes">Scopes</Label>
                  <Input id="scopes" placeholder="openid email profile" {...form.register("scopes")} />
                </div>
                <DialogFooter>
                  <Button type="submit" variant="primary">
                    Create provider
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
            Loading providers...
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-lg bg-muted/30 p-6 text-sm text-muted-foreground">
            No providers yet.
          </div>
        ) : (
          <DataTable columns={columns} data={providers} />
        )}
      </div>
    </div>
  );
}
