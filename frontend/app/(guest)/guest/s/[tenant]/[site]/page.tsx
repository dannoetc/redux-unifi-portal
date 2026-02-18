"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { apiFetch, API_BASE_URL, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PORTAL_TEMPLATE_TOKEN = "{{portal}}";
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

type PortalTemplateMode = "off" | "replace" | "embed";
type PortalTheme = {
  card_alignment?: "left" | "center" | "right" | null;
  card_max_width_px?: number | null;
  logo_size_px?: number | null;
  logo_alignment?: "left" | "center" | "right" | null;
  heading_size_px?: number | null;
  body_size_px?: number | null;
  background_color?: string | null;
  card_background_color?: string | null;
  text_color?: string | null;
  connect_button_color?: string | null;
};

const applyTemplateTokens = (
  template: string,
  tokens: Record<string, string | null | undefined>
) => {
  let output = template;

  // Minimal support for `{{#if key}}...{{else}}...{{/if}}` blocks so templates can toggle logo fallbacks.
  output = output.replace(
    /{{#if (\w+)}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g,
    (_match, key: string, truthy: string, falsy?: string) => {
      const value = tokens[key];
      const hasValue = value !== null && value !== undefined && value !== "";
      return hasValue ? truthy : falsy ?? "";
    }
  );

  Object.entries(tokens).forEach(([key, value]) => {
    output = output.replaceAll(`{{${key}}}`, value ?? "");
  });
  return output;
};

const escapeHtml = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const sanitizeHtmlForInjection = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  if (typeof window === "undefined") {
    return value;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const key = attribute.name.toLowerCase();
      const normalizedValue = attribute.value.trim().toLowerCase();
      if (key.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (
        (key === "href" || key === "src") &&
        (normalizedValue.startsWith("javascript:") || normalizedValue.startsWith("data:text/html"))
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return doc.body.innerHTML;
};

const sanitizeContinueUrl = (value: string | null | undefined) => {
  if (!value || typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = new URL(value, window.location.origin);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    if (value.startsWith("/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const clampNumber = (value: number | null | undefined, minimum: number, maximum: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(minimum, Math.min(maximum, value));
};

const resolveTemplateMode = (
  mode: string | null | undefined,
  enabled: boolean | null | undefined,
  html: string | null | undefined
): PortalTemplateMode => {
  if (mode === "off" || mode === "replace" || mode === "embed") {
    return mode;
  }
  if (!enabled) {
    return "off";
  }
  if (html?.includes(PORTAL_TEMPLATE_TOKEN)) {
    return "embed";
  }
  return "replace";
};

type ConfigResponse = {
  branding: {
    logo_url?: string | null;
    primary_color?: string | null;
    terms_html?: string | null;
    support_contact?: string | null;
    display_name?: string | null;
  };
  portal_template?: {
    enabled?: boolean;
    mode?: PortalTemplateMode | null;
    html?: string | null;
    theme?: PortalTheme | null;
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
  const [tosAccepted, setTosAccepted] = useState(false);
  const [continueUrl, setContinueUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);

  const portalParam = searchParams.get("portal_session_id");
  const errorParam = searchParams.get("error");
  const previewParam = searchParams.get("preview");
  const templateMode = resolveTemplateMode(
    config?.portal_template?.mode,
    config?.portal_template?.enabled,
    config?.portal_template?.html
  );
  const templateTheme = config?.portal_template?.theme ?? null;
  const logoSizePx = clampNumber(templateTheme?.logo_size_px, 24, 240) ?? 48;
  const headingSizePx = clampNumber(templateTheme?.heading_size_px, 18, 56) ?? 24;
  const bodySizePx = clampNumber(templateTheme?.body_size_px, 12, 24) ?? 14;
  const cardMaxWidthPx = clampNumber(templateTheme?.card_max_width_px, 320, 1024) ?? 420;
  const logoAlignment = templateTheme?.logo_alignment ?? "left";
  const cardAlignment = templateTheme?.card_alignment ?? "center";
  const connectButtonColor = templateTheme?.connect_button_color ?? config?.branding.primary_color ?? null;

  const brandStyle = useMemo(() => {
    if (!config?.branding.primary_color && !templateTheme?.card_background_color) {
      return undefined;
    }
    return {
      borderColor: config?.branding.primary_color ?? undefined,
      backgroundColor: templateTheme?.card_background_color ?? undefined,
      color: templateTheme?.text_color ?? undefined,
      maxWidth: `${cardMaxWidthPx}px`,
      fontSize: `${bodySizePx}px`,
    } as CSSProperties;
  }, [bodySizePx, cardMaxWidthPx, config, templateTheme?.card_background_color, templateTheme?.text_color]);

  const primaryButtonStyle = useMemo(() => {
    if (!connectButtonColor) {
      return undefined;
    }
    return { backgroundColor: connectButtonColor } as CSSProperties;
  }, [connectButtonColor]);

  const pageStyle = useMemo(() => {
    if (!templateTheme?.background_color && !templateTheme?.text_color) {
      return undefined;
    }
    return {
      backgroundColor: templateTheme?.background_color ?? undefined,
      color: templateTheme?.text_color ?? undefined,
    } as CSSProperties;
  }, [templateTheme?.background_color, templateTheme?.text_color]);

  const cardContainerStyle = useMemo(() => {
    if (cardAlignment === "left") {
      return { justifyContent: "flex-start" } as CSSProperties;
    }
    if (cardAlignment === "right") {
      return { justifyContent: "flex-end" } as CSSProperties;
    }
    return { justifyContent: "center" } as CSSProperties;
  }, [cardAlignment]);

  const logoContainerClass = useMemo(() => {
    if (logoAlignment === "center") {
      return "justify-center";
    }
    if (logoAlignment === "right") {
      return "justify-end";
    }
    return "justify-start";
  }, [logoAlignment]);

  const templateTokens = useMemo(
    () => ({
      display_name: escapeHtml(config?.branding.display_name),
      logo_url: escapeHtml(config?.branding.logo_url),
      primary_color: escapeHtml(config?.branding.primary_color),
      terms_html: sanitizeHtmlForInjection(config?.branding.terms_html),
      support_contact: escapeHtml(config?.branding.support_contact),
      connect_button_color: connectButtonColor,
      logo_size_px: String(logoSizePx),
      heading_size_px: String(headingSizePx),
      body_size_px: String(bodySizePx),
      card_max_width_px: String(cardMaxWidthPx),
      card_alignment: cardAlignment,
      logo_alignment: logoAlignment,
      background_color: templateTheme?.background_color,
      card_background_color: templateTheme?.card_background_color,
      text_color: templateTheme?.text_color,
    }),
    [cardAlignment, cardMaxWidthPx, config, connectButtonColor, headingSizePx, logoAlignment, logoSizePx, templateTheme]
  );

  const resolvedTemplate = useMemo(() => {
    if (templateMode === "off" || !config?.portal_template?.html) {
      return null;
    }
    return sanitizeHtmlForInjection(applyTemplateTokens(config.portal_template.html, templateTokens));
  }, [config?.portal_template?.html, templateMode, templateTokens]);

  const sanitizedTermsHtml = useMemo(
    () => sanitizeHtmlForInjection(config?.branding.terms_html),
    [config?.branding.terms_html]
  );
  const safeContinueUrl = useMemo(() => sanitizeContinueUrl(continueUrl), [continueUrl]);

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

        if (previewParam) {
          setLoading(false);
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

  const executeWithClientRetry = useCallback(async <T,>(action: () => Promise<T>) => {
    const maxAttempts = 3;
    const baseDelayMs = 900;
    setAuthPending(true);
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await action();
        } catch (error) {
          const apiError = error instanceof ApiError ? error : null;
          if (apiError?.code === "CLIENT_NOT_FOUND" && attempt < maxAttempts) {
            const delay = baseDelayMs * attempt;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
      }
      throw new Error("Unable to authorize.");
    } finally {
      setAuthPending(false);
    }
  }, []);

  const sendVoucher = async () => {
    if (!portalSessionId || !params?.tenant || !params?.site) {
      toast.error("Missing portal session.");
      return;
    }
    try {
      const data = await executeWithClientRetry(() =>
        apiFetch<VoucherResponse>(`/api/guest/${params.tenant}/${params.site}/voucher`, {
          method: "POST",
          body: JSON.stringify({ portal_session_id: portalSessionId, code: voucherCode }),
        })
      );
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
      const data = await executeWithClientRetry(() =>
        apiFetch<VoucherResponse>(`/api/guest/${params.tenant}/${params.site}/otp/verify`, {
          method: "POST",
          body: JSON.stringify({
            portal_session_id: portalSessionId,
            email: otpEmail,
            code: otpCode,
          }),
        })
      );
      setContinueUrl(data.continue_url);
      setActivePanel("success");
      toast.success("Verified.");
    } catch (error: any) {
      toast.error(error?.message ?? "Invalid code.");
    }
  };

  const acceptTos = useCallback(async () => {
    if (!portalSessionId || !params?.tenant || !params?.site) {
      toast.error("Missing portal session.");
      return;
    }
    try {
      const data = await executeWithClientRetry(() =>
        apiFetch<VoucherResponse>(`/api/guest/${params.tenant}/${params.site}/tos/accept`, {
          method: "POST",
          body: JSON.stringify({ portal_session_id: portalSessionId }),
        })
      );
      setContinueUrl(data.continue_url);
      setActivePanel("success");
      toast.success("Connected.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to connect.");
    }
  }, [executeWithClientRetry, params?.site, params?.tenant, portalSessionId]);

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

  const portalCard = (
    <Card style={brandStyle}>
      <CardHeader className="space-y-3">
        <div className={`flex items-center gap-3 ${logoContainerClass}`}>
          {config?.branding.logo_url ? (
            <img
              src={config.branding.logo_url}
              alt={config.branding.display_name ?? "Site logo"}
              className="rounded-lg object-contain"
              style={{ height: `${logoSizePx}px`, width: `${logoSizePx}px` }}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              style={{ height: `${logoSizePx}px`, width: `${logoSizePx}px` }}
            >
              WiFi
            </div>
          )}
          <div>
            <CardTitle style={{ fontSize: `${headingSizePx}px` }}>
              {config?.branding.display_name ?? "Connect to WiFi"}
            </CardTitle>
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
            {previewParam ? (
              <div className="rounded-md border border-dashed border-input bg-muted/30 p-3 text-xs text-muted-foreground">
                Preview mode. Authorization actions are disabled.
              </div>
            ) : null}
            {methods.includes("tos_only") && (
              <div className="space-y-3">
                {sanitizedTermsHtml ? (
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border border-input"
                      checked={tosAccepted}
                      onChange={(event) => setTosAccepted(event.target.checked)}
                    />
                    <span>I agree to the Terms of Service</span>
                  </label>
                ) : null}
                <Button
                  className="w-full"
                  style={primaryButtonStyle}
                  onClick={acceptTos}
                  disabled={
                    !portalSessionId ||
                    Boolean(previewParam) ||
                    (sanitizedTermsHtml ? !tosAccepted : false) ||
                    authPending
                  }
                >
                  {authPending ? "Authorizing..." : "Accept terms and connect"}
                </Button>
              </div>
            )}
            {methods.includes("oidc") && (
              <Button
                className="w-full"
                style={primaryButtonStyle}
                onClick={startSso}
                disabled={!portalSessionId || Boolean(previewParam) || authPending}
              >
                Continue with SSO
              </Button>
            )}
            {methods.includes("voucher") && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setActivePanel("voucher")}
                disabled={!portalSessionId || Boolean(previewParam) || authPending}
              >
                Use voucher code
              </Button>
            )}
            {methods.includes("email_otp") && (
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => setActivePanel("otp")}
                disabled={!portalSessionId || Boolean(previewParam) || authPending}
              >
                Email me a code
              </Button>
            )}
            {methods.includes("oidc") && openInBrowserUrl ? (
              <a
                className="block text-center text-xs text-muted-foreground underline"
                href={openInBrowserUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
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
                autoCapitalize="characters"
                autoCorrect="off"
                onChange={(event) => setVoucherCode(event.target.value.trim().toUpperCase())}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                style={primaryButtonStyle}
                onClick={sendVoucher}
                disabled={!voucherCode || authPending}
              >
                {authPending ? "Authorizing..." : "Connect"}
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
                autoComplete="email"
                placeholder="you@example.com"
                value={otpEmail}
                onChange={(event) => setOtpEmail(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                style={primaryButtonStyle}
                onClick={startOtp}
                disabled={!otpEmail || authPending}
              >
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
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D+/g, ""))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                style={primaryButtonStyle}
                onClick={verifyOtp}
                disabled={!otpCode || authPending}
              >
                {authPending ? "Authorizing..." : "Verify"}
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
            {safeContinueUrl ? (
              <Button asChild className="w-full">
                <a href={safeContinueUrl}>Continue</a>
              </Button>
            ) : null}
          </div>
        )}

        {sanitizedTermsHtml ? (
          <div
            className="rounded-md border bg-white/70 p-3 text-xs text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizedTermsHtml }}
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
  );
  const portalCardElement = (
    <div className="flex w-full" style={cardContainerStyle}>
      {portalCard}
    </div>
  );

  const renderedTemplate = useMemo(() => {
    if (!resolvedTemplate || templateMode === "off") {
      return null;
    }
    if (templateMode === "replace") {
      return (
        <div className="space-y-6">
          <div dangerouslySetInnerHTML={{ __html: resolvedTemplate }} />
        </div>
      );
    }

    const segments = resolvedTemplate.split(PORTAL_TEMPLATE_TOKEN);
    if (segments.length === 1) {
      // Compatibility fallback if an old template enabled embed mode without the token.
      return (
        <div className="space-y-6">
          <div dangerouslySetInnerHTML={{ __html: segments[0] }} />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {segments.map((segment, index) => (
          <div key={`segment-${index}`} className="space-y-6">
            {segment ? <div dangerouslySetInnerHTML={{ __html: segment }} /> : null}
            {index < segments.length - 1 ? portalCardElement : null}
          </div>
        ))}
      </div>
    );
  }, [portalCardElement, resolvedTemplate, templateMode]);

  useEffect(() => {
    if (!resolvedTemplate) {
      return;
    }

    const btn = document.getElementById("sponsored-connect") as HTMLButtonElement | null;
    if (!btn) {
      return;
    }

    const handleClick = () => {
      void acceptTos();
    };

    btn.disabled = Boolean(previewParam) || !portalSessionId || authPending;
    btn.addEventListener("click", handleClick);

    // Expose for templates that execute their own scripts.
    (window as any).acceptTosFromTemplate = acceptTos;

    return () => {
      btn.removeEventListener("click", handleClick);
      if ((window as any).acceptTosFromTemplate === acceptTos) {
        delete (window as any).acceptTosFromTemplate;
      }
    };
  }, [acceptTos, authPending, portalSessionId, previewParam, resolvedTemplate]);

  if (loading && !config) {
    return (
      <main className="surface-grid min-h-screen px-4 py-8" style={pageStyle}>
        <div className="mx-auto max-w-md rounded-xl border border-border/70 bg-card/90 p-6 text-sm text-muted-foreground">
          Loading portal...
        </div>
      </main>
    );
  }

  return (
    <main className="surface-grid min-h-screen px-4 py-8" style={pageStyle}>
      <div className="mx-auto w-full max-w-4xl">
        {renderedTemplate ?? portalCardElement}
      </div>
    </main>
  );
}
