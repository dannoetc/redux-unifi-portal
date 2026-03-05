"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const setupSchema = z
  .object({
    admin_email: z.string().email(),
    admin_password: z.string().min(8),
    tenant_name: z.string().min(2),
    tenant_slug: z.string().min(2).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    create_initial_site: z.boolean().default(false),
    site_slug: z.string().optional(),
    site_display_name: z.string().optional(),
    unifi_site_id: z.string().optional(),
    unifi_base_url: z.string().optional(),
    unifi_port: z
      .preprocess(
        (value) => (value === "" || value === null || typeof value === "undefined" ? undefined : value),
        z.coerce.number().int().min(1).max(65535).optional()
      )
      .optional(),
    unifi_api_key: z.string().optional(),
  })
  .superRefine((values, context) => {
    if (!values.create_initial_site) {
      return;
    }
    if (!values.site_slug || values.site_slug.trim().length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Site slug is required when creating an initial site.",
        path: ["site_slug"],
      });
    }
    if (!values.site_display_name || values.site_display_name.trim().length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Site display name is required when creating an initial site.",
        path: ["site_display_name"],
      });
    }
  });

type SetupFormValues = z.infer<typeof setupSchema>;

type SetupStatus = {
  bootstrapped: boolean;
  has_superadmin: boolean;
  defaults: {
    admin_email?: string;
    tenant_name?: string;
    tenant_slug?: string;
    site_slug?: string;
    site_display_name?: string;
    unifi_base_url?: string;
    unifi_port?: number;
  };
};

function SetupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      create_initial_site: false,
      unifi_port: 443,
      unifi_site_id: "default",
    },
  });

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      try {
        const data = await apiFetch<SetupStatus>("/api/setup/status");
        if (!active) {
          return;
        }
        if (data.bootstrapped) {
          router.replace("/admin/login");
          return;
        }
        setStatus(data);
      } catch (error: any) {
        toast.error(error?.message ?? "Unable to load setup status.");
      } finally {
        if (active) {
          setLoadingStatus(false);
        }
      }
    };
    void loadStatus();
    return () => {
      active = false;
    };
  }, [router]);

  const mergedDefaults = useMemo(() => {
    const defaults = status?.defaults ?? {};
    return {
      admin_email: searchParams.get("admin_email") ?? defaults.admin_email ?? "",
      tenant_name: searchParams.get("tenant_name") ?? defaults.tenant_name ?? "",
      tenant_slug: searchParams.get("tenant_slug") ?? defaults.tenant_slug ?? "",
      site_slug: searchParams.get("site_slug") ?? defaults.site_slug ?? "",
      site_display_name: searchParams.get("site_display_name") ?? defaults.site_display_name ?? "",
      unifi_base_url: searchParams.get("unifi_base_url") ?? defaults.unifi_base_url ?? "",
      unifi_port: Number(searchParams.get("unifi_port") ?? defaults.unifi_port ?? 443),
    };
  }, [searchParams, status?.defaults]);

  useEffect(() => {
    if (!status) {
      return;
    }
    reset({
      admin_email: mergedDefaults.admin_email,
      tenant_name: mergedDefaults.tenant_name,
      tenant_slug: mergedDefaults.tenant_slug,
      create_initial_site: Boolean(mergedDefaults.site_slug || mergedDefaults.site_display_name),
      site_slug: mergedDefaults.site_slug,
      site_display_name: mergedDefaults.site_display_name,
      unifi_site_id: "default",
      unifi_base_url: mergedDefaults.unifi_base_url,
      unifi_port: mergedDefaults.unifi_port,
      admin_password: "",
      unifi_api_key: "",
    });
  }, [mergedDefaults, reset, status]);

  const createInitialSite = watch("create_initial_site");

  const onSubmit = async (values: SetupFormValues) => {
    const payload: Record<string, unknown> = {
      admin_email: values.admin_email,
      admin_password: values.admin_password,
      tenant_name: values.tenant_name,
      tenant_slug: values.tenant_slug,
      create_initial_site: values.create_initial_site,
    };

    if (values.create_initial_site) {
      payload.site = {
        site_slug: values.site_slug?.trim(),
        site_display_name: values.site_display_name?.trim(),
        unifi_site_id: values.unifi_site_id?.trim() || "default",
        unifi_base_url: values.unifi_base_url?.trim() || undefined,
        unifi_port: values.unifi_port ?? 443,
        unifi_api_key: values.unifi_api_key?.trim() || undefined,
      };
    }

    try {
      await apiFetch("/api/setup/bootstrap", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success("Setup complete.");
      router.replace("/admin");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to complete setup.");
    }
  };

  if (loadingStatus) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Card className="rounded-xl border bg-card p-6 shadow-soft">
          <p className="text-sm text-muted-foreground">Loading setup wizard...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Card className="rounded-xl border bg-card p-6 shadow-soft">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Initial setup wizard</h1>
          <p className="text-sm text-muted-foreground">
            Create your first superadmin and tenant. This wizard is only available before first bootstrap.
          </p>
        </div>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <section className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <h2 className="text-sm font-semibold text-foreground">Step 1: Initial superadmin</h2>
            <div className="space-y-2">
              <Label htmlFor="admin_email">Admin email</Label>
              <Input id="admin_email" type="email" {...register("admin_email")} />
              {errors.admin_email ? <p className="text-xs text-destructive">{errors.admin_email.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_password">Admin password</Label>
              <Input id="admin_password" type="password" {...register("admin_password")} />
              {errors.admin_password ? (
                <p className="text-xs text-destructive">{errors.admin_password.message}</p>
              ) : null}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <h2 className="text-sm font-semibold text-foreground">Step 2: Initial tenant</h2>
            <div className="space-y-2">
              <Label htmlFor="tenant_name">Tenant name</Label>
              <Input id="tenant_name" {...register("tenant_name")} />
              {errors.tenant_name ? <p className="text-xs text-destructive">{errors.tenant_name.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant_slug">Tenant slug</Label>
              <Input id="tenant_slug" {...register("tenant_slug")} />
              {errors.tenant_slug ? <p className="text-xs text-destructive">{errors.tenant_slug.message}</p> : null}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Step 3: Optional initial site</h2>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" className="peer sr-only" {...register("create_initial_site")} />
                <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
              </label>
            </div>
            {createInitialSite ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="site_slug">Site slug</Label>
                  <Input id="site_slug" {...register("site_slug")} />
                  {errors.site_slug ? <p className="text-xs text-destructive">{errors.site_slug.message}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="site_display_name">Site display name</Label>
                  <Input id="site_display_name" {...register("site_display_name")} />
                  {errors.site_display_name ? (
                    <p className="text-xs text-destructive">{errors.site_display_name.message}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_site_id">UniFi site ID</Label>
                  <Input id="unifi_site_id" {...register("unifi_site_id")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_port">UniFi port</Label>
                  <Input id="unifi_port" type="number" min={1} max={65535} {...register("unifi_port")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="unifi_base_url">UniFi base URL</Label>
                  <Input id="unifi_base_url" placeholder="https://controller.example.com" {...register("unifi_base_url")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="unifi_api_key">UniFi API key</Label>
                  <Input id="unifi_api_key" type="password" {...register("unifi_api_key")} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Skip site provisioning for now and add sites later from the admin console.
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Completing setup..." : "Complete setup"}
            </Button>
            <Link className="text-sm text-muted-foreground underline underline-offset-4" href="/admin/login">
              Back to login
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-4 py-10">
          <Card className="rounded-xl border bg-card p-6 shadow-soft">
            <p className="text-sm text-muted-foreground">Loading setup wizard...</p>
          </Card>
        </div>
      }
    >
      <SetupPageContent />
    </Suspense>
  );
}
