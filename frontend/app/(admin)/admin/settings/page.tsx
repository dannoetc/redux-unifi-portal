"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type SmtpSettings = {
  host: string;
  port: number;
  username: string;
  from_email: string;
  from_name: string;
  password_configured: boolean;
};

type SystemPreferences = {
  compact_tables: boolean;
  show_setup_checklists: boolean;
};

type SystemSettings = {
  smtp: SmtpSettings;
  preferences: SystemPreferences;
};

type SettingsSnapshot = {
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpFromEmail: string;
  smtpFromName: string;
  compactTables: boolean;
  showSetupChecklists: boolean;
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

export default function SettingsPage() {
  const { adminUser } = useTenantSelection();
  const canManage = adminUser?.is_superadmin ?? false;

  const [loading, setLoading] = useState(true);

  const [tlsStatus, setTlsStatus] = useState<TlsStatus | null>(null);
  const [certificatePem, setCertificatePem] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [savingTls, setSavingTls] = useState(false);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpPasswordConfigured, setSmtpPasswordConfigured] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [savingSystem, setSavingSystem] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);

  const [compactTables, setCompactTables] = useState(false);
  const [showSetupChecklists, setShowSetupChecklists] = useState(true);
  const [baseline, setBaseline] = useState<SettingsSnapshot | null>(null);

  const currentSnapshot = useMemo<SettingsSnapshot>(
    () => ({
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpFromEmail,
      smtpFromName,
      compactTables,
      showSetupChecklists,
    }),
    [
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpFromEmail,
      smtpFromName,
      compactTables,
      showSetupChecklists,
    ]
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!baseline) {
      return false;
    }
    const baselineEntries = Object.entries(baseline) as [keyof SettingsSnapshot, string | boolean][];
    const changedFields = baselineEntries.some(([key, value]) => currentSnapshot[key] !== value);
    return changedFields || clearPassword || smtpPassword.trim().length > 0;
  }, [baseline, currentSnapshot, clearPassword, smtpPassword]);
  const isBusy = savingTls || savingSystem || testingSmtp;
  const smtpStatusHint = useMemo(() => {
    if (clearPassword) {
      return "Stored password will be removed when you save.";
    }
    if (smtpPassword.trim()) {
      return "A new password will be saved.";
    }
    return smtpPasswordConfigured ? "A password is currently stored." : "No password is currently stored.";
  }, [clearPassword, smtpPassword, smtpPasswordConfigured]);

  const buildSnapshot = (settingsData: SystemSettings): SettingsSnapshot => ({
    smtpHost: settingsData.smtp.host,
    smtpPort: String(settingsData.smtp.port),
    smtpUsername: settingsData.smtp.username ?? "",
    smtpFromEmail: settingsData.smtp.from_email,
    smtpFromName: settingsData.smtp.from_name,
    compactTables: Boolean(settingsData.preferences.compact_tables),
    showSetupChecklists: Boolean(settingsData.preferences.show_setup_checklists),
  });

  const loadData = async () => {
    const [settingsData, tlsData] = await Promise.all([
      apiFetch<SystemSettings>("/api/admin/system/settings"),
      apiFetch<TlsStatus>("/api/admin/system/tls"),
    ]);

    setTlsStatus(tlsData);

    const snapshot = buildSnapshot(settingsData);
    setSmtpHost(snapshot.smtpHost);
    setSmtpPort(snapshot.smtpPort);
    setSmtpUsername(snapshot.smtpUsername);
    setSmtpFromEmail(snapshot.smtpFromEmail);
    setSmtpFromName(snapshot.smtpFromName);
    setSmtpPassword("");
    setSmtpPasswordConfigured(settingsData.smtp.password_configured);
    setClearPassword(false);

    setCompactTables(snapshot.compactTables);
    setShowSetupChecklists(snapshot.showSetupChecklists);
    setBaseline(snapshot);
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
    loadData()
      .catch((error: any) => {
        toast.error(error?.message ?? "Unable to load system settings.");
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
    file
      .text()
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

  const refreshTlsStatus = async () => {
    const data = await apiFetch<TlsStatus>("/api/admin/system/tls");
    setTlsStatus(data);
  };

  const uploadCustomCertificate = async () => {
    if (!certificatePem.trim() || !privateKeyPem.trim()) {
      toast.error("Provide both certificate and private key.");
      return;
    }
    setSavingTls(true);
    try {
      const data = await apiFetch<TlsStatus>("/api/admin/system/tls/custom", {
        method: "PUT",
        body: JSON.stringify({
          certificate_pem: certificatePem,
          private_key_pem: privateKeyPem,
        }),
      });
      setTlsStatus(data);
      setCertificatePem("");
      setPrivateKeyPem("");
      toast.success("Custom certificate uploaded.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to upload certificate.");
    } finally {
      setSavingTls(false);
    }
  };

  const switchToLetsEncrypt = async () => {
    setSavingTls(true);
    try {
      const data = await apiFetch<TlsStatus>("/api/admin/system/tls/mode", {
        method: "PUT",
        body: JSON.stringify({ mode: "letsencrypt" }),
      });
      setTlsStatus(data);
      toast.success("Switched to Let's Encrypt mode.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to switch mode.");
    } finally {
      setSavingTls(false);
    }
  };

  const resetUnsaved = () => {
    if (!baseline) {
      return;
    }
    setSmtpHost(baseline.smtpHost);
    setSmtpPort(baseline.smtpPort);
    setSmtpUsername(baseline.smtpUsername);
    setSmtpFromEmail(baseline.smtpFromEmail);
    setSmtpFromName(baseline.smtpFromName);
    setCompactTables(baseline.compactTables);
    setShowSetupChecklists(baseline.showSetupChecklists);
    setSmtpPassword("");
    setClearPassword(false);
  };

  const saveSystemSettings = async () => {
    const parsedPort = Number.parseInt(smtpPort, 10);
    if (!smtpHost.trim()) {
      toast.error("SMTP host is required.");
      return;
    }
    if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      toast.error("SMTP port must be between 1 and 65535.");
      return;
    }
    if (!smtpFromEmail.trim()) {
      toast.error("From email is required.");
      return;
    }
    if (!smtpFromName.trim()) {
      toast.error("From name is required.");
      return;
    }

    setSavingSystem(true);
    try {
      const payload: {
        host: string;
        port: number;
        username: string;
        from_email: string;
        from_name: string;
        clear_password: boolean;
        password?: string;
      } = {
        host: smtpHost.trim(),
        port: parsedPort,
        username: smtpUsername.trim(),
        from_email: smtpFromEmail.trim(),
        from_name: smtpFromName.trim(),
        clear_password: clearPassword,
      };
      if (smtpPassword.trim()) {
        payload.password = smtpPassword;
      }

      const [smtpData, preferenceData] = await Promise.all([
        apiFetch<SmtpSettings>("/api/admin/system/settings/smtp", {
          method: "PUT",
          body: JSON.stringify(payload),
        }),
        apiFetch<SystemPreferences>("/api/admin/system/settings/preferences", {
          method: "PUT",
          body: JSON.stringify({
            compact_tables: compactTables,
            show_setup_checklists: showSetupChecklists,
          }),
        }),
      ]);

      setSmtpHost(smtpData.host);
      setSmtpPort(String(smtpData.port));
      setSmtpUsername(smtpData.username ?? "");
      setSmtpFromEmail(smtpData.from_email);
      setSmtpFromName(smtpData.from_name);
      setSmtpPassword("");
      setSmtpPasswordConfigured(smtpData.password_configured);
      setClearPassword(false);
      setCompactTables(Boolean(preferenceData.compact_tables));
      setShowSetupChecklists(Boolean(preferenceData.show_setup_checklists));
      setBaseline({
        smtpHost: smtpData.host,
        smtpPort: String(smtpData.port),
        smtpUsername: smtpData.username ?? "",
        smtpFromEmail: smtpData.from_email,
        smtpFromName: smtpData.from_name,
        compactTables: Boolean(preferenceData.compact_tables),
        showSetupChecklists: Boolean(preferenceData.show_setup_checklists),
      });
      toast.success("System settings saved.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to save settings.");
    } finally {
      setSavingSystem(false);
    }
  };

  const sendSmtpTest = async () => {
    if (hasUnsavedChanges) {
      toast.error("Save settings before sending a test email.");
      return;
    }
    if (!smtpTestEmail.trim()) {
      toast.error("Provide an email address for SMTP test.");
      return;
    }
    setTestingSmtp(true);
    try {
      await apiFetch("/api/admin/system/settings/smtp/test", {
        method: "POST",
        body: JSON.stringify({ to_email: smtpTestEmail.trim() }),
      });
      toast.success("SMTP test email sent.");
    } catch (error: any) {
      toast.error(error?.message ?? "SMTP test failed.");
    } finally {
      setTestingSmtp(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading system settings...</div>;
  }

  if (!canManage) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Superadmin access is required to manage system settings.
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
          Centralized system controls for TLS certificates, email delivery, and admin preferences.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button variant="secondary" onClick={resetUnsaved} disabled={!hasUnsavedChanges || isBusy}>
            Reset
          </Button>
          <Button onClick={() => void saveSystemSettings()} disabled={!hasUnsavedChanges || isBusy}>
            Save changes
          </Button>
        </div>
      </div>

      <Tabs defaultValue="email" className="space-y-4">
        <TabsList>
          <TabsTrigger value="email">Email + Preferences</TabsTrigger>
          <TabsTrigger value="tls">Certificates</TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>SMTP delivery</CardTitle>
                <CardDescription>
                  Configure system email delivery for OTP and notification workflows.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="smtp-host">Host</Label>
                    <Input
                      id="smtp-host"
                      value={smtpHost}
                      onChange={(event) => setSmtpHost(event.target.value)}
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input
                      id="smtp-port"
                      type="number"
                      value={smtpPort}
                      onChange={(event) => setSmtpPort(event.target.value)}
                      min={1}
                      max={65535}
                    />
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label htmlFor="smtp-username">Username</Label>
                    <Input
                      id="smtp-username"
                      value={smtpUsername}
                      onChange={(event) => setSmtpUsername(event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label htmlFor="smtp-password">Password</Label>
                    <Input
                      id="smtp-password"
                      type="password"
                      value={smtpPassword}
                      onChange={(event) => setSmtpPassword(event.target.value)}
                      placeholder="Leave blank to keep current"
                    />
                    <p className="text-xs text-muted-foreground">{smtpStatusHint}</p>
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={clearPassword}
                        onChange={(event) => setClearPassword(event.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      Clear stored password
                    </label>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="smtp-from-email">From email</Label>
                    <Input
                      id="smtp-from-email"
                      value={smtpFromEmail}
                      onChange={(event) => setSmtpFromEmail(event.target.value)}
                      placeholder="wifi@example.com"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="smtp-from-name">From name</Label>
                    <Input
                      id="smtp-from-name"
                      value={smtpFromName}
                      onChange={(event) => setSmtpFromName(event.target.value)}
                      placeholder="ReduxTC WiFi"
                    />
                  </div>
                </div>

                <div className="grid gap-2 rounded-md border border-border/60 p-3">
                  <Label htmlFor="smtp-test-email">Send test email</Label>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <Input
                      id="smtp-test-email"
                      value={smtpTestEmail}
                      onChange={(event) => setSmtpTestEmail(event.target.value)}
                      placeholder="admin@example.com"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => void sendSmtpTest()}
                      disabled={isBusy}
                      className="md:w-auto"
                    >
                      Send test
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Save changes first so the test uses the latest SMTP settings.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Preferences</CardTitle>
                <CardDescription>Default behavior for admin workflows.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-start gap-3 rounded-md border border-border/60 p-3">
                  <input
                    type="checkbox"
                    checked={compactTables}
                    onChange={(event) => setCompactTables(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    <span className="text-sm font-medium text-foreground">Compact table rows</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Reduce row spacing in lists to fit more content in view.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-md border border-border/60 p-3">
                  <input
                    type="checkbox"
                    checked={showSetupChecklists}
                    onChange={(event) => setShowSetupChecklists(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    <span className="text-sm font-medium text-foreground">Show setup checklists</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Keep onboarding and setup guidance visible in admin pages.
                    </span>
                  </span>
                </label>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tls" className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>TLS certificates</CardTitle>
              <CardDescription>
                Review the active certificate and manage certificate source.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                <div>
                  Domain: <span className="font-medium text-foreground">{tlsStatus?.domain ?? "Unknown"}</span>
                </div>
                <div>
                  Mode: <span className="font-medium text-foreground">{tlsStatus?.mode ?? "Unknown"}</span>
                </div>
                <div>
                  Managed by Certbot:{" "}
                  <span className="font-medium text-foreground">
                    {tlsStatus?.managed_by_certbot ? "Yes" : "No"}
                  </span>
                </div>
                <div>
                  Certificate present:{" "}
                  <span className="font-medium text-foreground">
                    {tlsStatus?.certificate_present ? "Yes" : "No"}
                  </span>
                </div>
                <div className="md:col-span-2">
                  Issuer:{" "}
                  <span className="font-medium text-foreground">{tlsStatus?.issuer ?? "Not available"}</span>
                </div>
                <div className="md:col-span-2">
                  Subject:{" "}
                  <span className="font-medium text-foreground">{tlsStatus?.subject ?? "Not available"}</span>
                </div>
                <div>
                  Not before:{" "}
                  <span className="font-medium text-foreground">{formatDate(tlsStatus?.not_before)}</span>
                </div>
                <div>
                  Not after:{" "}
                  <span className="font-medium text-foreground">{formatDate(tlsStatus?.not_after)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void refreshTlsStatus()} disabled={isBusy}>
                  Refresh status
                </Button>
                <Button onClick={() => void switchToLetsEncrypt()} disabled={isBusy}>
                  Use Let&apos;s Encrypt
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Upload custom certificate</CardTitle>
              <CardDescription>
                Paste PEM contents or load files. Uploading switches TLS mode to custom.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="settings-cert-file">Certificate file</Label>
                <Input
                  id="settings-cert-file"
                  type="file"
                  accept=".pem,.crt,.cer,.txt"
                  onChange={(event) => loadTextFile(event, "cert")}
                />
                <Textarea
                  value={certificatePem}
                  onChange={(event) => setCertificatePem(event.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  className="min-h-[150px] font-mono text-xs"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-key-file">Private key file</Label>
                <Input
                  id="settings-key-file"
                  type="file"
                  accept=".pem,.key,.txt"
                  onChange={(event) => loadTextFile(event, "key")}
                />
                <Textarea
                  value={privateKeyPem}
                  onChange={(event) => setPrivateKeyPem(event.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  className="min-h-[150px] font-mono text-xs"
                />
              </div>
              <div>
                <Button onClick={() => void uploadCustomCertificate()} disabled={isBusy}>
                  Upload custom certificate
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
