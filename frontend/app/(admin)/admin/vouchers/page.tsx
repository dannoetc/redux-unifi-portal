"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { apiDownloadCsv, apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(2),
  count: z.coerce.number().min(1),
  code_length: z.coerce.number().min(4).max(16),
  max_uses_per_code: z.coerce.number().min(1),
  expires_at: z.string().optional().or(z.literal("")),
});

type VoucherForm = z.infer<typeof schema>;

type Site = {
  id: string;
  display_name: string;
};

type SiteList = { sites: Site[] };

type BatchResponse = { batch_id: string; count: number };

export default function VouchersPage() {
  const { tenantId, tenants, setTenantId, loading: tenantLoading } = useTenantSelection();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [batchId, setBatchId] = useState<string>("");

  const form = useForm<VoucherForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      count: 25,
      code_length: 8,
      max_uses_per_code: 1,
    },
  });

  useEffect(() => {
    if (!tenantId) {
      setSites([]);
      setSiteId("");
      return;
    }
    let active = true;
    apiFetch<SiteList>(`/api/admin/tenants/${tenantId}/sites`)
      .then((data) => {
        if (!active) {
          return;
        }
        setSites(data.sites);
        setSiteId((current) => current || data.sites[0]?.id || "");
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load sites.");
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const onSubmit = async (values: VoucherForm) => {
    if (!tenantId || !siteId) {
      toast.error("Select a tenant and site first.");
      return;
    }
    try {
      const data = await apiFetch<BatchResponse>(
        `/api/admin/tenants/${tenantId}/sites/${siteId}/vouchers/batches`,
        {
          method: "POST",
          body: JSON.stringify(values),
        }
      );
      setBatchId(data.batch_id);
      toast.success(`Batch created (${data.count} codes).`);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create voucher batch.");
    }
  };

  const exportCsv = async (targetBatchId: string) => {
    if (!tenantId || !siteId || !targetBatchId) {
      toast.error("Provide tenant, site, and batch ID.");
      return;
    }
    try {
      await apiDownloadCsv(
        `/api/admin/tenants/${tenantId}/sites/${siteId}/vouchers/batches/${targetBatchId}/export.csv`,
        `vouchers-${targetBatchId}.csv`
      );
      toast.success("CSV downloaded.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to export vouchers.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Voucher batches</h1>
        <p className="mt-1 text-sm text-muted-foreground">Generate access codes and export CSVs.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create batch</CardTitle>
          <CardDescription>Generate vouchers for a single site.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tenant">Tenant</Label>
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
            <div className="space-y-2">
              <Label htmlFor="site">Site</Label>
              <select
                id="site"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
                disabled={!tenantId || sites.length === 0}
              >
                {sites.length === 0 && <option value="">No sites available</option>}
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label htmlFor="name">Batch name</Label>
              <Input id="name" {...form.register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="count">Count</Label>
              <Input id="count" type="number" {...form.register("count")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code_length">Code length</Label>
              <Input id="code_length" type="number" {...form.register("code_length")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_uses_per_code">Max uses per code</Label>
              <Input id="max_uses_per_code" type="number" {...form.register("max_uses_per_code")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expires_at">Expires at (ISO)</Label>
              <Input id="expires_at" placeholder="2026-01-15T12:00:00" {...form.register("expires_at")} />
            </div>
            <div className="flex items-end">
              <Button type="submit">Generate vouchers</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Export vouchers</CardTitle>
          <CardDescription>Download CSV for an existing batch.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="batch_id">Batch ID</Label>
            <Input
              id="batch_id"
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              placeholder="UUID"
            />
          </div>
          <Button variant="outline" onClick={() => exportCsv(batchId)}>
            Export CSV
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
