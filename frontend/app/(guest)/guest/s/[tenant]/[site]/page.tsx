"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { apiFetch, API_BASE_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

type ConfigResponse = {
  branding: {
    logo_url?: string | null;
    primary_color?: string | null;
    terms_html?: string | null;
    support_contact?: string | null;
    display_name?: string | null;
  };
  methods: string[];
  policy: {
    time_limit_minutes?: number | null;
    data_limit_mb?: number | null;
    rx_kbps?: number | null;
    tx_kbps?: number | null;
  };
};

type SessionInitResponse = { portal_session_id: string; methods: string[] };

type VoucherResponse = { continue_url: string };

export default function GuestLanding() {
  const searchParams = useSearchParams();
  const params = useParams<{ tenant: string; site: string }>();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [portalSessionId, setPortalSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<"choose" | "voucher" | "otp" | "otp-verify" | "success">("choose");
  const [voucherCode, setVoucherCode] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [continueUrl, setContinueUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const portalParam = searchParams.get("portal_session_id");
  const errorParam = searchParams.get("error");

  const brandStyle = useMemo(() => {
    if (!config?.branding.primary_color) {
      return undefined;
    }
    return { borderColor: config.branding.primary_color } as CSSProperties;
  }, [config]);

  const primaryButtonStyle = useMemo(() => {
    if (!config?.branding.primary_color) {
      return undefined;
    }
    return { backgroundColor: config.branding.primary_color } as CSSProperties;
  }, [config]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!params?.tenant || !params?.site) {
          return;
        }
        const configData = await apiFetch<ConfigResponse>(
          `/api/guest/${params.tenant}/${params.site}/config`
        );
        if (!active) {
          return;
        }
        setConfig(configData);
        setMethods(configData.methods);

        if (portalParam) {
          setPortalSessionId(portalParam);
          return;
        }

        const clientMac = searchParams.get("id");
        if (!clientMac) {
          setErrorMessage("Missing client MAC address. Launch from UniFi captive portal.");
          return;
        }

        const initData = await apiFetch<SessionInitResponse>(
          `/api/guest/${params.tenant}/${params.site}/session/init`,
          {
            method: "POST",
            body: JSON.stringify({
              ap: searchParams.get("ap"),
              id: clientMac,
              ssid: searchParams.get("ssid"),
              url: searchParams.get("url"),
              t: searchParams.get("t"),
              user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            }),
          }
        );
        if (!active) {
          return;
        }
        setPortalSessionId(initData.portal_session_id);
        setMethods(initData.methods);
      } catch (error: any) {
        if (active) {
          const message = error?.message ?? "Unable to start session.";
          setErrorMessage(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [params, portalParam, searchParams]);

  const sendVoucher = async () => {
    if (!portalSessionId || !params?.tenant || !params?.site) {
      toast.error("Missing portal session.");
      return;
    }
    try {
      const data = await apiFetch<VoucherResponse>(`/api/guest/${params.tenant}/${params.site}/voucher`, {
        method: "POST",
        body: JSON.stringify({ portal_session_id: portalSessionId, code: voucherCode }),
      });
      setContinueUrl(data.continue_url);
      setActivePanel("success");
      toast.success("Voucher accepted.");
    } catch (error: any) {
      toast.error(error?.message ?? "Voucher invalid.");
    }
  };

  const startOtp = async () => {
    if (!portalSessionId || !params?.tenant || !params?.site) {
      toast.error("Missing portal session.");
      return;
    }
    try {
      await apiFetch(`/api/guest/${params.tenant}/${params.site}/otp/start`, {
        method: "POST",
        body: JSON.stringify({ portal_session_id: portalSessionId, email: otpEmail }),
      });
      setActivePanel("otp-verify");
      toast.success("Code sent.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to send code.");
    }
  };

  const verifyOtp = async () => {
    if (!portalSessionId || !params?.tenant || !params?.site) {
      toast.error("Missing portal session.");
      return;
    }
    try {
      const data = await apiFetch<VoucherResponse>(`/api/guest/${params.tenant}/${params.site}/otp/verify`, {
        method: "POST",
        body: JSON.stringify({
          portal_session_id: portalSessionId,
          email: otpEmail,
          code: otpCode,
        }),
      });
      setContinueUrl(data.continue_url);
      setActivePanel("success");
      toast.success("Verified.");
    } catch (error: any) {
      toast.error(error?.message ?? "Invalid code.");
    }
  };

  const startSso = () => {
    if (!portalSessionId || !params?.tenant || !params?.site) {
      toast.error("Missing portal session.");
      return;
    }
    window.location.href = `${API_BASE_URL}/api/oidc/${params.tenant}/${params.site}/start?portal_session_id=${portalSessionId}`;
  };

  const openInBrowserUrl = portalSessionId && params?.tenant && params?.site
    ? `${API_BASE_URL}/api/oidc/${params.tenant}/${params.site}/start?portal_session_id=${portalSessionId}`
    : "";

  return (
    <main className="surface-grid min-h-screen px-4 py-8">
      <div className="mx-auto max-w-md">
        <Card style={brandStyle}>
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              {config?.branding.logo_url ? (
                <img
                  src={config.branding.logo_url}
                  alt={config.branding.display_name ?? "Site logo"}
                  className="h-12 w-12 rounded-lg object-contain"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                  WiFi
                </div>
              )}
              <div>
                <CardTitle>{config?.branding.display_name ?? "Connect to WiFi"}</CardTitle>
                <CardDescription>Secure access for guests</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading portal session...</div>
            ) : null}

            {errorMessage && (
              <Alert className="border-destructive/40">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            {errorParam && (
              <Alert className="border-destructive/40">
                <AlertDescription>SSO failed: {errorParam}</AlertDescription>
              </Alert>
            )}

            {activePanel === "choose" && (
              <div className="space-y-3">
                {methods.includes("oidc") && (
                  <Button className="w-full" style={primaryButtonStyle} onClick={startSso} disabled={!portalSessionId}>
                    Continue with SSO
                  </Button>
                )}
                {methods.includes("voucher") && (
                  <Button className="w-full" variant="outline" onClick={() => setActivePanel("voucher")}
                    disabled={!portalSessionId}>
                    Use voucher code
                  </Button>
                )}
                {methods.includes("email_otp") && (
                  <Button className="w-full" variant="secondary" onClick={() => setActivePanel("otp")}
                    disabled={!portalSessionId}>
                    Email me a code
                  </Button>
                )}
                {methods.includes("oidc") && openInBrowserUrl ? (
                  <a className="block text-center text-xs text-muted-foreground underline" href={openInBrowserUrl} target="_blank" rel="noopener noreferrer">
                    Open in browser
                  </a>
                ) : null}
              </div>
            )}

            {activePanel === "voucher" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="voucher">Voucher code</Label>
                  <Input
                    id="voucher"
                    placeholder="ABC123"
                    value={voucherCode}
                    onChange={(event) => setVoucherCode(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" style={primaryButtonStyle} onClick={sendVoucher} disabled={!voucherCode}>
                    Connect
                  </Button>
                  <Button variant="ghost" onClick={() => setActivePanel("choose")}>Back</Button>
                </div>
              </div>
            )}

            {activePanel === "otp" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={otpEmail}
                    onChange={(event) => setOtpEmail(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" style={primaryButtonStyle} onClick={startOtp} disabled={!otpEmail}>
                    Send code
                  </Button>
                  <Button variant="ghost" onClick={() => setActivePanel("choose")}>Back</Button>
                </div>
              </div>
            )}

            {activePanel === "otp-verify" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="code">Verification code</Label>
                  <Input
                    id="code"
                    placeholder="123456"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" style={primaryButtonStyle} onClick={verifyOtp} disabled={!otpCode}>
                    Verify
                  </Button>
                  <Button variant="ghost" onClick={() => setActivePanel("otp")}>Back</Button>
                </div>
              </div>
            )}

            {activePanel === "success" && (
              <div className="space-y-3">
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  Connected. Your access is ready.
                </div>
                {continueUrl ? (
                  <Button asChild className="w-full">
                    <a href={continueUrl}>Continue</a>
                  </Button>
                ) : null}
              </div>
            )}

            {config?.branding.terms_html ? (
              <div
                className="rounded-md border bg-white/70 p-3 text-xs text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: config.branding.terms_html }}
              />
            ) : (
              <div className="text-xs text-muted-foreground">
                By continuing, you agree to the network terms and acceptable use policy.
              </div>
            )}

            {config?.branding.support_contact ? (
              <div className="text-xs text-muted-foreground">Support: {config.branding.support_contact}</div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
