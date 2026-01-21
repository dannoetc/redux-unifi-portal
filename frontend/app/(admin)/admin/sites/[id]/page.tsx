"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
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
  logo_url: z.string().optional().or(z.literal("")),
  primary_color: z.string().optional().or(z.literal("")),
  terms_html: z.string().optional().or(z.literal("")),
  portal_template_html: z.string().optional().or(z.literal("")),
  portal_template_enabled: z.boolean().default(false),
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

const displayUnifiHost = (value?: string | null) => {
  if (!value) {
    return "";
  }
  const withoutProtocol = value.replace(/^https?:\/\//i, "");
  return withoutProtocol.split("/")[0] ?? "";
};

export default function SiteDetailPage() {
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const tenantId = searchParams.get("tenant");
  const [site, setSite] = useState<SiteResponse | null>(null);
  const [providers, setProviders] = useState<OidcProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ latencyMs: number; siteName?: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const siteForm = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
  });

  const [oidcForm, setOidcForm] = useState<SiteOidcForm>({
    enabled: false,
    oidc_provider_id: "",
    allowed_email_domains: "",
  });
  const logoValue = siteForm.watch("logo_url");
  const portalTemplateEnabled = siteForm.watch("portal_template_enabled");

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
        const normalizedSite = {
          ...data.site,
          unifi_base_url: displayUnifiHost(data.site.unifi_base_url),
        };
        setSite(normalizedSite);
        siteForm.reset(normalizedSite);
        const providersData = await apiFetch<OidcProviderList>(
          `/api/admin/tenants/${tenantId}/oidc-providers`
        );
        if (!active) {
          return;
        }
        setProviders(providersData.providers);
        const tenantData = await apiFetch<{ tenant: { slug: string } }>(
          `/api/admin/tenants/${tenantId}`
        );
        if (!active) {
          return;
        }
        setTenantSlug(tenantData.tenant.slug);
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
      const payload = {
        ...values,
        unifi_base_url: normalizeUnifiBaseUrl(values.unifi_base_url),
      };
      const data = await apiFetch<{ site: SiteResponse }>(
        `/api/admin/tenants/${tenantId}/sites/${params.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
      setSite({
        ...data.site,
        unifi_base_url: displayUnifiHost(data.site.unifi_base_url),
      });
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

  const runUnifiTest = async () => {
    if (!tenantId || !params?.id) {
      return;
    }
    setTesting(true);
    setTestError(null);
    try {
      const response = await apiFetch<{ latency_ms: number; site?: { name?: string } }>(
        `/api/admin/tenants/${tenantId}/sites/${params.id}/unifi-test`,
        { method: "POST" }
      );
      setTestStatus({
        latencyMs: response.latency_ms,
        siteName: response.site?.name,
      });
      toast.success("UniFi API connection verified.");
    } catch (err: any) {
      const message = err?.message ?? "Unable to reach UniFi controller.";
      setTestError(message);
      toast.error(message);
    } finally {
      setTesting(false);
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

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const maxBytes = 512 * 1024;
    if (file.size > maxBytes) {
      toast.error("Logo file is too large. Use a file under 512KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        siteForm.setValue("logo_url", reader.result, { shouldDirty: true });
      }
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    siteForm.setValue("logo_url", "", { shouldDirty: true });
    if (logoInputRef.current) {
      logoInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Site settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {site?.display_name ?? "Branding, policy defaults, and UniFi connection."}
        </p>
        {tenantSlug && site?.slug ? (
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <a
              href={`/guest/s/${tenantSlug}/${site.slug}?preview=1`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview portal
            </a>
          </Button>
        ) : null}
      </div>
      {error && (
        <Alert className="border-destructive/40">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="rounded-xl border bg-card shadow-soft">
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Guest-facing identity and support info.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={siteForm.handleSubmit(saveSite)}>
            <div className="space-y-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input id="display_name" autoFocus {...siteForm.register("display_name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" {...siteForm.register("slug")} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="logo_upload">Logo upload</Label>
              <Input
                id="logo_upload"
                type="file"
                accept="image/*"
                ref={logoInputRef}
                onChange={handleLogoUpload}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Uploads are stored as data URLs. Use a small PNG/SVG.</span>
                {logoValue ? (
                  <Button type="button" variant="ghost" size="sm" onClick={clearLogo}>
                    Clear logo
                  </Button>
                ) : null}
              </div>
              {logoValue ? (
                <div className="flex items-center gap-3">
                  <img src={logoValue} alt="Logo preview" className="h-12 w-12 rounded-md object-contain" />
                  <span className="text-xs text-muted-foreground">Current logo preview</span>
                </div>
              ) : null}
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
                className="min-h-[120px] w-full rounded-md border border-input bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
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
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 md:col-span-2">
              <div>
                <div className="text-sm font-medium">Site enabled</div>
                <div className="text-xs text-muted-foreground">Toggle guest access for this site.</div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={Boolean(siteForm.watch("enabled"))}
                  onChange={() => siteForm.setValue("enabled", !siteForm.getValues("enabled"))}
                />
                <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
              </label>
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
              <Button type="submit" variant="primary">
                Save site
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-xl border bg-card shadow-soft">
        <CardHeader>
          <CardTitle>Portal template</CardTitle>
          <CardDescription>
            Optional custom HTML wrapper. Use {"{{portal}}"} to insert the built-in portal card.
            If omitted, the portal card is appended.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={siteForm.handleSubmit(saveSite)}>
            <div className="flex items-center gap-2">
              <input
                id="portal_template_enabled"
                type="checkbox"
                className="h-4 w-4 rounded border border-input"
                {...siteForm.register("portal_template_enabled")}
              />
              <Label htmlFor="portal_template_enabled">Enable custom template</Label>
            </div>
            <div className="text-xs text-muted-foreground">
              Tokens: {"{{display_name}}"}, {"{{logo_url}}"}, {"{{primary_color}}"}, {"{{terms_html}}"},{" "}
              {"{{support_contact}}"}.
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal_template_html">HTML template</Label>
              <textarea
                id="portal_template_html"
                className="min-h-[200px] w-full rounded-md border border-input bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
                placeholder="<section>{{portal}}</section>"
                disabled={!portalTemplateEnabled}
                {...siteForm.register("portal_template_html")}
              />
            </div>
            <div>
              <Button type="submit" variant="primary">
                Save template
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-xl border bg-card shadow-soft">
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
              <Button type="submit" variant="primary">
                Save policy
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-xl border bg-card shadow-soft">
        <CardHeader>
          <CardTitle>UniFi connection</CardTitle>
          <CardDescription>Store secret references in the backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={siteForm.handleSubmit(saveSite)}>
            <div className="space-y-2">
              <Label htmlFor="unifi_base_url">UniFi controller IP (optional override)</Label>
              <Input id="unifi_base_url" placeholder="71.162.143.124" {...siteForm.register("unifi_base_url")} />
              <p className="text-xs text-muted-foreground">
                We append {UNIFI_INTEGRATION_PATH} automatically.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unifi_site_id">UniFi site ID</Label>
              <Input id="unifi_site_id" {...siteForm.register("unifi_site_id")} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="unifi_api_key_ref">UniFi API key reference (optional override)</Label>
              <Input id="unifi_api_key_ref" type="password" {...siteForm.register("unifi_api_key_ref")} />
              <p className="text-xs text-muted-foreground">Use a secret reference, not a raw key.</p>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" variant="primary">
                Save UniFi settings
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-xl border bg-card shadow-soft">
        <CardHeader>
          <CardTitle>UniFi API health check</CardTitle>
          <CardDescription>Verify that the controller can be reached with the configured credentials.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {testStatus ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
              Connected in {testStatus.latencyMs}ms
              {testStatus.siteName ? ` - ${testStatus.siteName}` : null}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Run a quick request to validate UniFi API access.</div>
          )}
          {testError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {testError}
            </div>
          ) : null}
          <Button variant="secondary" onClick={runUnifiTest} disabled={testing}>
            {testing ? "Testing..." : "Run test"}
          </Button>
        </CardContent>
      </Card>
      <Card className="rounded-xl border bg-card shadow-soft">
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
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
          <Button variant="primary" onClick={saveOidc}>
            Save OIDC settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

