"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const siteSchema = z.object({
  display_name: z.string().min(2),
  slug: z.string().min(2),
  enabled: z.boolean().default(true),
  logo_url: z.string().url().optional().or(z.literal("")),
  primary_color: z.string().optional().or(z.literal("")),
  terms_html: z.string().optional().or(z.literal("")),
  support_contact: z.string().optional().or(z.literal("")),
  success_url: z.string().optional().or(z.literal("")),
  enable_tos_only: z.boolean().default(false),
  unifi_base_url: z.string().optional().or(z.literal("")),
  unifi_site_id: z.string().optional().or(z.literal("")),
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  default_time_limit_minutes: z.coerce.number().optional().nullable(),
  default_data_limit_mb: z.coerce.number().optional().nullable(),
  default_rx_kbps: z.coerce.number().optional().nullable(),
  default_tx_kbps: z.coerce.number().optional().nullable(),
});

type SiteFormValues = z.infer<typeof siteSchema>;

type SiteResponse = SiteFormValues & { id: string };

type OidcProvider = {
  id: string;
  issuer: string;
  client_id: string;
  client_secret_ref?: string | null;
  scopes?: string | null;
};

type OidcProviderList = { providers: OidcProvider[] };

type SiteOidcForm = {
  enabled: boolean;
  oidc_provider_id: string;
  allowed_email_domains: string;
};

export default function SiteDetailPage() {
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const tenantId = searchParams.get("tenant");
  const [site, setSite] = useState<SiteResponse | null>(null);
  const [providers, setProviders] = useState<OidcProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  const siteForm = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
  });

  const [oidcForm, setOidcForm] = useState<SiteOidcForm>({
    enabled: false,
    oidc_provider_id: "",
    allowed_email_domains: "",
  });

  useEffect(() => {
    if (!tenantId) {
      setError("Missing tenant context. Return to Sites list.");
      return;
    }
    let active = true;
    async function load() {
      try {
        if (!params?.id) {
          setError("Missing site ID.");
          return;
        }
        const data = await apiFetch<{ site: SiteResponse }>(
          `/api/admin/tenants/${tenantId}/sites/${params.id}`
        );
        if (!active) {
          return;
        }
        setSite(data.site);
        siteForm.reset(data.site);
        const providersData = await apiFetch<OidcProviderList>(
          `/api/admin/tenants/${tenantId}/oidc-providers`
        );
        if (!active) {
          return;
        }
        setProviders(providersData.providers);
      } catch (err: any) {
        toast.error(err?.message ?? "Unable to load site.");
        if (active) {
          setError(err?.message ?? "Unable to load site.");
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [tenantId, params, siteForm]);

  const saveSite = async (values: SiteFormValues) => {
    if (!tenantId) {
      return;
    }
    setError(null);
    if (!params?.id) {
      return;
    }
    try {
      const data = await apiFetch<{ site: SiteResponse }>(
        `/api/admin/tenants/${tenantId}/sites/${params.id}`,
        {
          method: "PUT",
          body: JSON.stringify(values),
        }
      );
      setSite(data.site);
      toast.success("Site updated.");
    } catch (err: any) {
      const message = err?.message ?? "Unable to update site.";
      setError(message);
      toast.error(message);
    }
  };

  const saveOidc = async () => {
    if (!tenantId) {
      return;
    }
    if (!params?.id) {
      return;
    }
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/sites/${params.id}/oidc`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: oidcForm.enabled,
          oidc_provider_id: oidcForm.oidc_provider_id || null,
          allowed_email_domains: oidcForm.allowed_email_domains
            ? oidcForm.allowed_email_domains.split(",").map((v) => v.trim())
            : null,
        }),
      });
      toast.success("OIDC settings saved.");
    } catch (err: any) {
      toast.error(err?.message ?? "Unable to save OIDC settings.");
    }
  };

  const policyFields = useMemo(
    () => [
      { key: "default_time_limit_minutes", label: "Time limit (minutes)" },
      { key: "default_data_limit_mb", label: "Data limit (MB)" },
      { key: "default_rx_kbps", label: "RX limit (kbps)" },
      { key: "default_tx_kbps", label: "TX limit (kbps)" },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Site settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {site?.display_name ?? "Branding, policy defaults, and UniFi connection."}
        </p>
      </div>
      {error && (
        <Alert className="border-destructive/40">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Guest-facing identity and support info.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={siteForm.handleSubmit(saveSite)}>
            <div className="space-y-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input id="display_name" {...siteForm.register("display_name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" {...siteForm.register("slug")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo_url">Logo URL</Label>
              <Input id="logo_url" {...siteForm.register("logo_url")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="primary_color">Primary color</Label>
              <Input id="primary_color" placeholder="#1f6feb" {...siteForm.register("primary_color")} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="terms_html">Terms HTML</Label>
              <textarea
                id="terms_html"
                className="min-h-[120px] w-full rounded-md border border-input bg-background p-3 text-sm"
                {...siteForm.register("terms_html")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support_contact">Support contact</Label>
              <Input id="support_contact" {...siteForm.register("support_contact")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="success_url">Success URL</Label>
              <Input id="success_url" {...siteForm.register("success_url")} />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="enabled"
                type="checkbox"
                className="h-4 w-4 rounded border border-input"
                {...siteForm.register("enabled")}
              />
              <Label htmlFor="enabled">Site enabled</Label>
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="enable_tos_only"
                type="checkbox"
                className="h-4 w-4 rounded border border-input"
                {...siteForm.register("enable_tos_only")}
              />
              <Label htmlFor="enable_tos_only">Enable TOS-only guest access</Label>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Save site</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Default policy</CardTitle>
          <CardDescription>Applied for voucher and OTP authorization.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={siteForm.handleSubmit(saveSite)}>
            {policyFields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input id={field.key} type="number" {...siteForm.register(field.key as keyof SiteFormValues)} />
              </div>
            ))}
            <div className="md:col-span-2">
              <Button type="submit">Save policy</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>UniFi connection</CardTitle>
          <CardDescription>Store secret references in the backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={siteForm.handleSubmit(saveSite)}>
            <div className="space-y-2">
              <Label htmlFor="unifi_base_url">UniFi base URL</Label>
              <Input id="unifi_base_url" {...siteForm.register("unifi_base_url")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unifi_site_id">UniFi site ID</Label>
              <Input id="unifi_site_id" {...siteForm.register("unifi_site_id")} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="unifi_api_key_ref">UniFi API key reference</Label>
              <Input id="unifi_api_key_ref" {...siteForm.register("unifi_api_key_ref")} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Save UniFi settings</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>OIDC enablement</CardTitle>
          <CardDescription>Allow guest SSO by tenant provider.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="oidc_provider">OIDC provider</Label>
              <select
                id="oidc_provider"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={oidcForm.oidc_provider_id}
                onChange={(event) =>
                  setOidcForm((prev) => ({ ...prev, oidc_provider_id: event.target.value }))
                }
              >
                <option value="">Select provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.issuer}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="allowed_domains">Allowed email domains</Label>
              <Input
                id="allowed_domains"
                placeholder="example.com, corp.io"
                value={oidcForm.allowed_email_domains}
                onChange={(event) =>
                  setOidcForm((prev) => ({ ...prev, allowed_email_domains: event.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="oidc_enabled"
                type="checkbox"
                className="h-4 w-4 rounded border border-input"
                checked={oidcForm.enabled}
                onChange={(event) =>
                  setOidcForm((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              <Label htmlFor="oidc_enabled">Enable OIDC for this site</Label>
            </div>
          </div>
          <Button onClick={saveOidc}>Save OIDC settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}
