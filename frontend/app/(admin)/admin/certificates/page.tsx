"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";

type TlsStatus = {
  mode: "letsencrypt" | "custom";
  domain: string;
  certificate_present: boolean;
  managed_by_certbot: boolean;
  issuer?: string | null;
  subject?: string | null;
  not_before?: string | null;
  not_after?: string | null;
  self_signed?: boolean | null;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export default function CertificatesPage() {
  const { adminUser } = useTenantSelection();
  const [status, setStatus] = useState<TlsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [certificatePem, setCertificatePem] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");

  const canManage = adminUser?.is_superadmin ?? false;

  const refreshStatus = async () => {
    const data = await apiFetch<TlsStatus>("/api/admin/system/tls");
    setStatus(data);
  };

  useEffect(() => {
    if (!adminUser) {
      return;
    }
    if (!canManage) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    refreshStatus()
      .catch((error: any) => {
        toast.error(error?.message ?? "Unable to load TLS status.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [adminUser, canManage]);

  const loadTextFile = (event: ChangeEvent<HTMLInputElement>, target: "cert" | "key") => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    file.text()
      .then((text) => {
        if (target === "cert") {
          setCertificatePem(text);
        } else {
          setPrivateKeyPem(text);
        }
      })
      .catch(() => {
        toast.error("Unable to read file.");
      });
  };

  const uploadCustomCertificate = async () => {
    if (!certificatePem.trim() || !privateKeyPem.trim()) {
      toast.error("Provide both certificate and private key.");
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetch<TlsStatus>("/api/admin/system/tls/custom", {
        method: "PUT",
        body: JSON.stringify({
          certificate_pem: certificatePem,
          private_key_pem: privateKeyPem,
        }),
      });
      setStatus(data);
      setCertificatePem("");
      setPrivateKeyPem("");
      toast.success("Custom certificate uploaded.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to upload certificate.");
    } finally {
      setSaving(false);
    }
  };

  const switchToLetsEncrypt = async () => {
    setSaving(true);
    try {
      const data = await apiFetch<TlsStatus>("/api/admin/system/tls/mode", {
        method: "PUT",
        body: JSON.stringify({ mode: "letsencrypt" }),
      });
      setStatus(data);
      toast.success("Switched to Let's Encrypt mode.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to switch mode.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading certificate settings...</div>;
  }

  if (!canManage) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Superadmin access is required to manage TLS certificates.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Certificates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage active TLS certificates for this deployment domain.
        </p>
      </div>

      <Card className="space-y-3 p-5">
        <div className="text-sm font-semibold">Current certificate</div>
        <div className="grid gap-2 text-sm text-muted-foreground">
          <div>
            Domain: <span className="font-medium text-foreground">{status?.domain ?? "Unknown"}</span>
          </div>
          <div>
            Mode: <span className="font-medium text-foreground">{status?.mode ?? "Unknown"}</span>
          </div>
          <div>
            Managed by Certbot:{" "}
            <span className="font-medium text-foreground">{status?.managed_by_certbot ? "Yes" : "No"}</span>
          </div>
          <div>
            Issuer: <span className="font-medium text-foreground">{status?.issuer ?? "Not available"}</span>
          </div>
          <div>
            Subject: <span className="font-medium text-foreground">{status?.subject ?? "Not available"}</span>
          </div>
          <div>
            Not before: <span className="font-medium text-foreground">{formatDate(status?.not_before)}</span>
          </div>
          <div>
            Not after: <span className="font-medium text-foreground">{formatDate(status?.not_after)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={refreshStatus} disabled={saving}>
            Refresh status
          </Button>
          <Button onClick={switchToLetsEncrypt} disabled={saving}>
            Use Let&apos;s Encrypt
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <div className="text-sm font-semibold">Upload custom certificate</div>
          <p className="text-xs text-muted-foreground">
            Paste PEM contents or load files. Applying this switches TLS mode to custom.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cert-file">Certificate file</Label>
          <input id="cert-file" type="file" accept=".pem,.crt,.cer,.txt" onChange={(e) => loadTextFile(e, "cert")} />
          <Textarea
            value={certificatePem}
            onChange={(e) => setCertificatePem(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
            className="min-h-[180px] font-mono text-xs"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="key-file">Private key file</Label>
          <input id="key-file" type="file" accept=".pem,.key,.txt" onChange={(e) => loadTextFile(e, "key")} />
          <Textarea
            value={privateKeyPem}
            onChange={(e) => setPrivateKeyPem(e.target.value)}
            placeholder="-----BEGIN PRIVATE KEY-----"
            className="min-h-[180px] font-mono text-xs"
          />
        </div>
        <Button onClick={uploadCustomCertificate} disabled={saving}>
          Upload custom certificate
        </Button>
      </Card>
    </div>
  );
}
