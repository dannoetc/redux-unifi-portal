"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { ApiError, apiDownloadFile, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const openvpnGenerateSchema = z.object({
  client_name: z.string().trim().min(1, "Client name is required.").max(64, "Client name is too long."),
  notes: z.string().trim().max(256, "Notes are too long.").optional().or(z.literal("")),
});

type GenerateFormValues = z.infer<typeof openvpnGenerateSchema>;

export type OpenVpnClient = {
  id: string;
  client_name: string;
  created_at: string;
};

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
};

type OpenVpnGenerateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: TenantSummary | null;
  onGenerated?: (client: OpenVpnClient) => void;
  onGeneratedAuth?: (auth: { username: string; password: string }) => void;
  onRefresh?: () => Promise<void> | void;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function OpenVpnGenerateDialog({
  open,
  onOpenChange,
  tenant,
  onGenerated,
  onGeneratedAuth,
  onRefresh,
}: OpenVpnGenerateDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [generatedClient, setGeneratedClient] = useState<OpenVpnClient | null>(null);
  const [generatedAuth, setGeneratedAuth] = useState<{ username: string; password: string } | null>(
    null
  );

  const form = useForm<GenerateFormValues>({
    resolver: zodResolver(openvpnGenerateSchema),
    defaultValues: { client_name: "", notes: "" },
  });

  useEffect(() => {
    if (!open) {
      form.reset({ client_name: "", notes: "" });
      setGeneratedClient(null);
      setGeneratedAuth(null);
      setSubmitting(false);
    }
  }, [open, form]);

  const handleDownload = async (client: OpenVpnClient) => {
    if (!tenant) {
      return;
    }
    try {
      await apiDownloadFile(
        `/api/admin/tenants/${tenant.id}/openvpn/profile`,
        `${client.client_name}.ovpn`
      );
      toast.success("OpenVPN profile downloaded.");
    } catch (error: any) {
      if (error instanceof ApiError && error.code === "OPENVPN_PROFILE_NOT_GENERATED") {
        toast.error("No generated profile exists — click Generate to create one.");
        return;
      }
      toast.error(error?.message ?? "Unable to download OpenVPN profile.");
    }
  };

  const onSubmit = async (values: GenerateFormValues) => {
    if (!tenant) {
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiFetch<
        | { client: OpenVpnClient; auth_username?: string | null; auth_password?: string | null }
        | { id?: string; client_name?: string; created_at?: string; auth_username?: string | null; auth_password?: string | null }
      >(
        `/api/admin/tenants/${tenant.id}/openvpn/generate`,
        {
          method: "POST",
          body: JSON.stringify({ client_name: values.client_name.trim() }),
        }
      );
      const authUsername = "auth_username" in data ? data.auth_username ?? "" : "";
      const authPassword = "auth_password" in data ? data.auth_password ?? "" : "";
      let resolvedClient: OpenVpnClient | null = null;
      if ("client" in data && data.client) {
        resolvedClient = data.client;
      } else {
        const legacy = data as { id?: string; client_name?: string; created_at?: string };
        if (legacy.client_name) {
          resolvedClient = {
            id: legacy.id ?? "",
            client_name: legacy.client_name,
            created_at: legacy.created_at ?? new Date().toISOString(),
          };
        }
      }
      if (!resolvedClient) {
        throw new Error("OpenVPN generation returned an invalid response.");
      }
      setGeneratedClient(resolvedClient);
      if (authUsername && authPassword) {
        const auth = { username: authUsername, password: authPassword };
        setGeneratedAuth(auth);
        onGeneratedAuth?.(auth);
      } else {
        setGeneratedAuth(null);
      }
      toast.success(`OpenVPN profile generated for ${resolvedClient.client_name}.`);
      onGenerated?.(resolvedClient);
      await onRefresh?.();
    } catch (error: any) {
      if (error instanceof ApiError) {
        if (error.code === "OPENVPN_NOT_CONFIGURED") {
          toast.error("OpenVPN is not configured for this tenant. See operations docs.");
        } else if (error.code === "OPENVPN_GENERATION_FAILED") {
          toast.error("OpenVPN generation failed. Check the tenant configuration.");
        } else {
          toast.error(error.message);
        }
      } else {
        toast.error(error?.message ?? "Unable to generate OpenVPN profile.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate OpenVPN gateway profile</DialogTitle>
          <DialogDescription>
            Enter a client name (used as the gateway identity). Profiles are stored encrypted and intended
            for gateway use only. This will not route general traffic through the VPN; the profile only
            provides access needed to reach UniFi devices. Profiles are split-tunnel only (redirect-gateway
            is removed).
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="openvpn_client_name">Client name</Label>
            <Input
              id="openvpn_client_name"
              placeholder="gateway-01"
              autoFocus
              {...form.register("client_name")}
            />
            {form.formState.errors.client_name ? (
              <p className="text-xs text-destructive">{form.formState.errors.client_name.message}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Use a unique client name per gateway to rotate profiles as needed.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="openvpn_notes">Notes (optional)</Label>
            <Textarea
              id="openvpn_notes"
              placeholder="Deployment notes or gateway location"
              {...form.register("notes")}
            />
            {form.formState.errors.notes ? (
              <p className="text-xs text-destructive">{form.formState.errors.notes.message}</p>
            ) : null}
          </div>
          {generatedClient ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <div className="font-semibold">Profile generated</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <span>{generatedClient.client_name}</span>
                <span className="text-emerald-600/80">
                  Created {formatDateTime(generatedClient.created_at)}
                </span>
              </div>
              {generatedAuth?.username && generatedAuth?.password ? (
                <div className="mt-2 rounded-sm border border-emerald-200/70 bg-white/70 px-2 py-1 text-[11px] text-emerald-700">
                  <div className="font-medium">Gateway credentials</div>
                  <div className="mt-1 grid gap-1">
                    <div>
                      <span className="font-semibold">Username:</span>{" "}
                      <span className="font-mono">{generatedAuth.username}</span>
                    </div>
                    <div>
                      <span className="font-semibold">Password:</span>{" "}
                      <span className="font-mono">{generatedAuth.password}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-emerald-700/80">
                  Add gateway credentials in Tenant networking to upload this profile in UniFi.
                </div>
              )}
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDownload(generatedClient)}
                >
                  Download profile
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Generating..." : "Generate profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
