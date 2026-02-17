"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const optionalText = z.string().optional().nullable().or(z.literal(""));
const optionalPort = z.preprocess(
  (value) => (value === "" || value === null || typeof value === "undefined" ? undefined : value),
  z.coerce.number().int().min(1).max(65535).optional()
);

const siteSchema = z.object({
  display_name: z.string().min(2),
  slug: z.string().min(2),
  enabled: z.boolean().default(true),
  logo_url: optionalText,
  primary_color: optionalText,
  terms_html: optionalText,
  portal_template_html: optionalText,
  portal_template_enabled: z.boolean().default(false),
  portal_template_mode: z.enum(["off", "replace", "embed"]).default("off"),
  support_contact: optionalText,
  success_url: optionalText,
  enable_tos_only: z.boolean().default(false),
  unifi_base_url: optionalText,
  unifi_port: optionalPort,
  unifi_site_id: optionalText,
  unifi_api_key: optionalText,
  default_time_limit_minutes: z.coerce.number().optional().nullable(),
  default_data_limit_mb: z.coerce.number().optional().nullable(),
  default_rx_kbps: z.coerce.number().optional().nullable(),
  default_tx_kbps: z.coerce.number().optional().nullable(),
});

type SiteFormValues = z.infer<typeof siteSchema>;

type SiteResponse = SiteFormValues & { id: string; unifi_api_key_stored?: boolean | null };
type PortalTemplateTheme = {
  card_alignment?: "left" | "center" | "right";
  card_max_width_px?: number;
  logo_size_px?: number;
  logo_alignment?: "left" | "center" | "right";
  heading_size_px?: number;
  body_size_px?: number;
  background_color?: string;
  card_background_color?: string;
  text_color?: string;
};
type TemplateEditorMode = "visual" | "code";
type PortalBuilderBlockType = "hero" | "text" | "portal" | "button" | "spacer";
type PortalBuilderBlock = {
  id: string;
  type: PortalBuilderBlockType;
  eyebrow?: string;
  title?: string;
  body?: string;
  backgroundColor?: string;
  textColor?: string;
  align?: "left" | "center" | "right";
  buttonLabel?: string;
  buttonColor?: string;
  heightPx?: number;
};
type SiteResponseWithTemplate = SiteResponse & {
  portal_template_theme?: PortalTemplateTheme | null;
};
type PortalTemplateVersion = {
  id: string;
  site_id: string;
  tenant_id: string;
  portal_template_mode: "off" | "embed" | "replace";
  portal_template_html?: string | null;
  portal_template_theme?: PortalTemplateTheme | null;
  created_by_admin_user_id?: string | null;
  created_at: string;
};
type PortalTemplateVersionList = {
  versions: PortalTemplateVersion[];
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    has_more: boolean;
  };
};

type OidcProvider = {
  id: string;
  issuer: string;
  client_id: string;
  client_secret_ref?: string | null;
  client_secret_stored?: boolean | null;
  scopes?: string | null;
};

type OidcProviderList = { providers: OidcProvider[] };

type SiteOidcForm = {
  enabled: boolean;
  oidc_provider_id: string;
  allowed_email_domains: string;
};

const UNIFI_INTEGRATION_PATH = "/proxy/network/integration";
const DEFAULT_UNIFI_PORT = 443;
const EXTERNAL_PORTAL_IP = process.env.NEXT_PUBLIC_PORTAL_IP ?? "0.0.0.0";
const PORTAL_VERSION_PAGE_SIZE = 10;
const BUILDER_META_PREFIX = "<!--portal_builder:";
const BUILDER_META_SUFFIX = "-->";

const TEMPLATE_PRESETS = {
  splitHero: `<section style="padding:24px;border-radius:16px;background:linear-gradient(135deg,#0f172a,#1f2937);color:#fff;">
  <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.75;">{{display_name}}</p>
  <h2 style="margin:0 0 12px;font-size:28px;line-height:1.2;">Guest WiFi Access</h2>
  <p style="margin:0;opacity:0.85;">Use the secure portal below to connect.</p>
</section>
<section style="margin-top:20px;">{{portal}}</section>`,
  centeredCard: `<section style="max-width:960px;margin:0 auto;padding:28px;border-radius:18px;background:#f8fafc;">
  <div style="text-align:center;margin-bottom:18px;">
    <img src="{{logo_url}}" alt="{{display_name}}" style="width:{{logo_size_px}}px;height:{{logo_size_px}}px;object-fit:contain;border-radius:12px;" />
    <h2 style="margin:12px 0 0;color:#0f172a;">{{display_name}}</h2>
  </div>
  {{portal}}
</section>`,
  customOnly: `<section style="max-width:720px;margin:0 auto;padding:28px;border:1px solid #dbe5ef;border-radius:16px;background:#ffffff;">
  <h2 style="margin-top:0;color:{{primary_color}};">Welcome to {{display_name}}</h2>
  <p style="font-size:15px;color:#334155;">Connect instantly with sponsored access.</p>
  <button id="sponsored-connect" style="margin-top:12px;padding:12px 18px;border:none;border-radius:10px;background:{{primary_color}};color:#fff;font-weight:600;cursor:pointer;">
    Accept terms and connect
  </button>
  <p style="margin-top:12px;font-size:12px;color:#64748b;">Support: {{support_contact}}</p>
</section>`,
} as const;

const DEFAULT_TEMPLATE_THEME: PortalTemplateTheme = {
  card_alignment: "center",
  card_max_width_px: 420,
  logo_size_px: 48,
  logo_alignment: "left",
  heading_size_px: 24,
  body_size_px: 14,
};

const DEFAULT_BUILDER_BLOCKS_EMBED: PortalBuilderBlock[] = [
  {
    id: "hero",
    type: "hero",
    eyebrow: "{{display_name}}",
    title: "Welcome to guest WiFi",
    body: "Connect securely using the portal below.",
    backgroundColor: "#0f172a",
    textColor: "#ffffff",
    align: "left",
  },
  {
    id: "portal",
    type: "portal",
    title: "Access portal",
    body: "Use voucher, email OTP, SSO, or terms-only access.",
    backgroundColor: "#ffffff",
    textColor: "#0f172a",
  },
];

const DEFAULT_BUILDER_BLOCKS_REPLACE: PortalBuilderBlock[] = [
  {
    id: "hero",
    type: "hero",
    eyebrow: "{{display_name}}",
    title: "Guest internet access",
    body: "Tap below to continue.",
    backgroundColor: "#1e293b",
    textColor: "#ffffff",
    align: "center",
  },
  {
    id: "button",
    type: "button",
    buttonLabel: "Accept terms and connect",
    buttonColor: "{{primary_color}}",
  },
  {
    id: "text",
    type: "text",
    body: "Support: {{support_contact}}",
    textColor: "#64748b",
  },
];

const createBuilderId = () =>
  `block-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const defaultBlockForType = (type: PortalBuilderBlockType): PortalBuilderBlock => {
  switch (type) {
    case "hero":
      return {
        id: createBuilderId(),
        type,
        eyebrow: "{{display_name}}",
        title: "Welcome",
        body: "Secure guest access.",
        backgroundColor: "#0f172a",
        textColor: "#ffffff",
        align: "left",
      };
    case "text":
      return {
        id: createBuilderId(),
        type,
        title: "Info",
        body: "Helpful instructions for guests.",
        textColor: "#0f172a",
      };
    case "portal":
      return {
        id: createBuilderId(),
        type,
        title: "Connect",
        body: "Use one of the available authentication methods.",
        backgroundColor: "#ffffff",
        textColor: "#0f172a",
      };
    case "button":
      return {
        id: createBuilderId(),
        type,
        buttonLabel: "Accept terms and connect",
        buttonColor: "{{primary_color}}",
      };
    case "spacer":
      return {
        id: createBuilderId(),
        type,
        heightPx: 24,
      };
    default:
      return {
        id: createBuilderId(),
        type: "text",
        body: "",
      };
  }
};

const escapeHtml = (value?: string) => {
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

const serializeBuilderBlocks = (blocks: PortalBuilderBlock[]) => {
  if (typeof window === "undefined" || typeof btoa !== "function") {
    return null;
  }
  try {
    const json = JSON.stringify(blocks);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  } catch {
    return null;
  }
};

const deserializeBuilderBlocks = (encoded: string): PortalBuilderBlock[] | null => {
  if (typeof window === "undefined" || typeof atob !== "function") {
    return null;
  }
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const blocks: PortalBuilderBlock[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as Partial<PortalBuilderBlock>;
      const type = candidate.type;
      if (!type || !["hero", "text", "portal", "button", "spacer"].includes(type)) {
        continue;
      }
      blocks.push({
        id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : createBuilderId(),
        type: type as PortalBuilderBlockType,
        eyebrow: candidate.eyebrow ?? "",
        title: candidate.title ?? "",
        body: candidate.body ?? "",
        backgroundColor: candidate.backgroundColor ?? "",
        textColor: candidate.textColor ?? "",
        align: candidate.align ?? "left",
        buttonLabel: candidate.buttonLabel ?? "",
        buttonColor: candidate.buttonColor ?? "",
        heightPx: typeof candidate.heightPx === "number" ? candidate.heightPx : 24,
      });
    }
    return blocks.length > 0 ? blocks : null;
  } catch {
    return null;
  }
};

const stripBuilderMeta = (template: string) => {
  const trimmed = template.trimStart();
  if (!trimmed.startsWith(BUILDER_META_PREFIX)) {
    return template;
  }
  const endIndex = trimmed.indexOf(BUILDER_META_SUFFIX);
  if (endIndex === -1) {
    return template;
  }
  return trimmed.slice(endIndex + BUILDER_META_SUFFIX.length).trimStart();
};

const parseBuilderMeta = (template: string): PortalBuilderBlock[] | null => {
  const trimmed = template.trimStart();
  if (!trimmed.startsWith(BUILDER_META_PREFIX)) {
    return null;
  }
  const endIndex = trimmed.indexOf(BUILDER_META_SUFFIX);
  if (endIndex === -1) {
    return null;
  }
  const encoded = trimmed.slice(BUILDER_META_PREFIX.length, endIndex).trim();
  if (!encoded) {
    return null;
  }
  return deserializeBuilderBlocks(encoded);
};

const defaultBuilderBlocksForMode = (mode: "off" | "embed" | "replace") => {
  if (mode === "replace") {
    return DEFAULT_BUILDER_BLOCKS_REPLACE.map((block) => ({ ...block, id: createBuilderId() }));
  }
  return DEFAULT_BUILDER_BLOCKS_EMBED.map((block) => ({ ...block, id: createBuilderId() }));
};

const renderBuilderBlock = (block: PortalBuilderBlock) => {
  switch (block.type) {
    case "hero": {
      const align = block.align ?? "left";
      return `<section style="padding:24px;border-radius:16px;background:${block.backgroundColor || "#0f172a"};color:${block.textColor || "#ffffff"};text-align:${align};">
  ${block.eyebrow ? `<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.75;">${escapeHtml(block.eyebrow)}</p>` : ""}
  ${block.title ? `<h2 style="margin:0 0 10px;font-size:28px;line-height:1.2;">${escapeHtml(block.title)}</h2>` : ""}
  ${block.body ? `<p style="margin:0;opacity:0.88;">${escapeHtml(block.body)}</p>` : ""}
</section>`;
    }
    case "text":
      return `<section style="padding:16px 4px;color:${block.textColor || "#0f172a"};">
  ${block.title ? `<h3 style="margin:0 0 8px;font-size:20px;">${escapeHtml(block.title)}</h3>` : ""}
  ${block.body ? `<p style="margin:0;line-height:1.6;">${escapeHtml(block.body)}</p>` : ""}
</section>`;
    case "portal":
      return `<section style="padding:18px;border:1px solid #dbe5ef;border-radius:14px;background:${block.backgroundColor || "#ffffff"};color:${block.textColor || "#0f172a"};">
  ${block.title ? `<h3 style="margin:0 0 8px;font-size:18px;">${escapeHtml(block.title)}</h3>` : ""}
  ${block.body ? `<p style="margin:0 0 14px;font-size:14px;opacity:0.85;">${escapeHtml(block.body)}</p>` : ""}
  {{portal}}
</section>`;
    case "button":
      return `<section style="padding:8px 0;">
  <button id="sponsored-connect" style="padding:12px 18px;border:none;border-radius:10px;background:${block.buttonColor || "{{primary_color}}"};color:#fff;font-weight:600;cursor:pointer;">
    ${escapeHtml(block.buttonLabel || "Accept terms and connect")}
  </button>
</section>`;
    case "spacer":
      return `<div style="height:${Math.max(8, Math.min(180, Number(block.heightPx ?? 24)))}px;"></div>`;
    default:
      return "";
  }
};

const buildTemplateFromBlocks = (
  blocks: PortalBuilderBlock[],
  mode: "off" | "embed" | "replace"
) => {
  if (mode === "off") {
    return "";
  }
  const rendered = blocks.map((block) => renderBuilderBlock(block)).join("\n");
  const withRequiredPortal =
    mode === "embed" && !rendered.includes("{{portal}}")
      ? `${rendered}\n<section style="margin-top:20px;">{{portal}}</section>`
      : rendered;
  const encoded = serializeBuilderBlocks(blocks);
  if (!encoded) {
    return withRequiredPortal;
  }
  return `${BUILDER_META_PREFIX}${encoded}${BUILDER_META_SUFFIX}\n${withRequiredPortal}`.trim();
};

const parseUnifiHostAndPort = (value?: string | null) => {
  if (!value) {
    return { host: "", port: DEFAULT_UNIFI_PORT };
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    const parsedPort = url.port ? Number(url.port) : DEFAULT_UNIFI_PORT;
    return {
      host: url.hostname,
      port: Number.isNaN(parsedPort) ? DEFAULT_UNIFI_PORT : parsedPort,
    };
  } catch {
    return { host: value, port: DEFAULT_UNIFI_PORT };
  }
};

const applyUnifiPort = (value: string | undefined | null, port: number | undefined) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const { host, port: parsedPort } = parseUnifiHostAndPort(trimmed);
  const resolvedPort = port ?? parsedPort;
  if (!resolvedPort || resolvedPort === DEFAULT_UNIFI_PORT) {
    return host;
  }
  return `${host}:${resolvedPort}`;
};

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
  return parseUnifiHostAndPort(value).host;
};

const displayUnifiPort = (value?: string | null) => {
  return parseUnifiHostAndPort(value).port;
};

const normalizeTemplateTheme = (theme?: PortalTemplateTheme | null): PortalTemplateTheme => ({
  ...DEFAULT_TEMPLATE_THEME,
  ...(theme ?? {}),
});

const pruneTemplateTheme = (theme: PortalTemplateTheme): PortalTemplateTheme | null => {
  const cleaned = Object.entries(theme).reduce((acc, [key, value]) => {
    if (value === null || value === undefined || value === "") {
      return acc;
    }
    (acc as any)[key] = value;
    return acc;
  }, {} as PortalTemplateTheme);
  return Object.keys(cleaned).length > 0 ? cleaned : null;
};

export default function SiteDetailPage() {
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const tenantId = searchParams.get("tenant");
  const [site, setSite] = useState<SiteResponseWithTemplate | null>(null);
  const [providers, setProviders] = useState<OidcProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ latencyMs: number; siteName?: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const portalUrlRef = useRef<HTMLInputElement | null>(null);
  const originalUnifiPortRef = useRef<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("branding");
  const [portalTheme, setPortalTheme] = useState<PortalTemplateTheme>(DEFAULT_TEMPLATE_THEME);
  const [templateEditorMode, setTemplateEditorMode] = useState<TemplateEditorMode>("visual");
  const [builderBlocks, setBuilderBlocks] = useState<PortalBuilderBlock[]>(DEFAULT_BUILDER_BLOCKS_EMBED);
  const [portalDesignDirty, setPortalDesignDirty] = useState(false);
  const [portalVersions, setPortalVersions] = useState<PortalTemplateVersion[]>([]);
  const [portalVersionsLoading, setPortalVersionsLoading] = useState(false);
  const [portalVersionsOffset, setPortalVersionsOffset] = useState(0);
  const [portalVersionsTotal, setPortalVersionsTotal] = useState(0);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

  const siteForm = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
  });

  const [oidcForm, setOidcForm] = useState<SiteOidcForm>({
    enabled: false,
    oidc_provider_id: "",
    allowed_email_domains: "",
  });
  const [logoSource, setLogoSource] = useState<"upload" | "url" | "none">("none");
  const logoValue = siteForm.watch("logo_url");
  const portalTemplateMode = siteForm.watch("portal_template_mode");
  const portalTemplateEnabled = portalTemplateMode !== "off";
  const formIsDirty = siteForm.formState.isDirty;
  const canSave = formIsDirty || portalDesignDirty;

  const syncTemplateEditorFromHtml = useCallback((
    templateHtml: string,
    mode: "off" | "embed" | "replace"
  ) => {
    const parsedBuilder = parseBuilderMeta(templateHtml);
    if (parsedBuilder) {
      setBuilderBlocks(parsedBuilder);
      setTemplateEditorMode("visual");
      return;
    }
    if (!templateHtml.trim()) {
      setBuilderBlocks(defaultBuilderBlocksForMode(mode));
      setTemplateEditorMode("visual");
      return;
    }
    setBuilderBlocks(defaultBuilderBlocksForMode(mode));
    setTemplateEditorMode("code");
  }, []);

  const loadPortalVersions = useCallback(async (requestedOffset = 0) => {
    if (!tenantId || !params?.id) {
      return;
    }
    setPortalVersionsLoading(true);
    try {
      const data = await apiFetch<PortalTemplateVersionList>(
        `/api/admin/tenants/${tenantId}/sites/${params.id}/portal-template-versions?limit=${PORTAL_VERSION_PAGE_SIZE}&offset=${requestedOffset}`
      );
      setPortalVersions(data.versions);
      setPortalVersionsOffset(data.pagination?.offset ?? requestedOffset);
      setPortalVersionsTotal(data.pagination?.total ?? data.versions.length);
    } catch (err: any) {
      toast.error(err?.message ?? "Unable to load template version history.");
    } finally {
      setPortalVersionsLoading(false);
    }
  }, [params?.id, tenantId]);

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
        const data = await apiFetch<{ site: SiteResponseWithTemplate }>(
          `/api/admin/tenants/${tenantId}/sites/${params.id}`
        );
        if (!active) {
          return;
        }
        const computedPort = displayUnifiPort(data.site.unifi_base_url);
        const normalizedPort = computedPort !== DEFAULT_UNIFI_PORT ? computedPort : undefined;
        originalUnifiPortRef.current = normalizedPort;

        const normalizedSite = {
          ...data.site,
          unifi_base_url: displayUnifiHost(data.site.unifi_base_url),
          unifi_port: normalizedPort,
          unifi_api_key: "",
          portal_template_mode:
            data.site.portal_template_mode ??
            (data.site.portal_template_enabled
              ? data.site.portal_template_html?.includes("{{portal}}")
                ? "embed"
                : "replace"
              : "off"),
        };
        setSite(normalizedSite);
        siteForm.reset(normalizedSite);
        setPortalTheme(normalizeTemplateTheme(data.site.portal_template_theme));
        syncTemplateEditorFromHtml(
          normalizedSite.portal_template_html ?? "",
          normalizedSite.portal_template_mode ?? "off"
        );
        setPortalDesignDirty(false);
        await loadPortalVersions(0);
        // Initialize logoSource based on whether logo_url is set
        setLogoSource(normalizedSite.logo_url ? "url" : "none");
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
  }, [tenantId, params, siteForm, syncTemplateEditorFromHtml, loadPortalVersions]);

  const saveSite = async (values: SiteFormValues) => {
    if (!tenantId) {
      return;
    }
    setError(null);
    if (!params?.id) {
      return;
    }
    try {
      const { unifi_port, ...rest } = values;
      const portToUse = typeof unifi_port === "number" ? unifi_port : originalUnifiPortRef.current;
      const unifiHost = applyUnifiPort(values.unifi_base_url, portToUse);
      const templateMode = values.portal_template_mode ?? "off";
      const visualTemplateHtml = buildTemplateFromBlocks(builderBlocks, templateMode);
      const resolvedTemplateHtml =
        templateMode === "off"
          ? ""
          : templateEditorMode === "visual"
            ? visualTemplateHtml
            : (rest.portal_template_html ?? "");
      const payload = {
        ...rest,
        portal_template_html: resolvedTemplateHtml,
        portal_template_enabled: templateMode !== "off",
        portal_template_mode: templateMode,
        portal_template_theme: pruneTemplateTheme(portalTheme),
        unifi_base_url: normalizeUnifiBaseUrl(unifiHost),
        unifi_api_key: values.unifi_api_key?.trim() ? values.unifi_api_key : undefined,
      };
      const data = await apiFetch<{ site: SiteResponseWithTemplate }>(
        `/api/admin/tenants/${tenantId}/sites/${params.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
      const normalizedSite = {
        ...data.site,
        unifi_base_url: displayUnifiHost(data.site.unifi_base_url),
        unifi_port: displayUnifiPort(data.site.unifi_base_url),
        unifi_api_key: "",
        portal_template_mode:
          data.site.portal_template_mode ??
          (data.site.portal_template_enabled
            ? data.site.portal_template_html?.includes("{{portal}}")
              ? "embed"
              : "replace"
            : "off"),
      };
      setSite(normalizedSite);
      siteForm.reset(normalizedSite);
      setPortalTheme(normalizeTemplateTheme(data.site.portal_template_theme));
      syncTemplateEditorFromHtml(
        normalizedSite.portal_template_html ?? "",
        normalizedSite.portal_template_mode ?? "off"
      );
      await loadPortalVersions(0);
      setPortalDesignDirty(false);
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
  const fieldLabels: Record<keyof SiteFormValues, string> = {
    display_name: "Display name",
    slug: "Slug",
    enabled: "Site enabled",
    logo_url: "Logo URL",
    primary_color: "Primary color",
    terms_html: "Terms HTML",
    portal_template_html: "Portal template HTML",
    portal_template_enabled: "Portal template enabled",
    portal_template_mode: "Portal template mode",
    support_contact: "Support contact",
    success_url: "Success URL",
    enable_tos_only: "TOS-only access",
    unifi_base_url: "UniFi controller IP",
    unifi_port: "UniFi controller port",
    unifi_site_id: "UniFi site ID",
    unifi_api_key: "UniFi API key",
    default_time_limit_minutes: "Time limit (minutes)",
    default_data_limit_mb: "Data limit (MB)",
    default_rx_kbps: "RX limit (kbps)",
    default_tx_kbps: "TX limit (kbps)",
  };
  const fieldTabs: Record<keyof SiteFormValues, string> = {
    display_name: "branding",
    slug: "branding",
    enabled: "branding",
    logo_url: "branding",
    primary_color: "branding",
    terms_html: "branding",
    support_contact: "branding",
    success_url: "branding",
    enable_tos_only: "branding",
    portal_template_enabled: "portal",
    portal_template_mode: "portal",
    portal_template_html: "portal",
    default_time_limit_minutes: "policy",
    default_data_limit_mb: "policy",
    default_rx_kbps: "policy",
    default_tx_kbps: "policy",
    unifi_base_url: "unifi",
    unifi_port: "unifi",
    unifi_site_id: "unifi",
    unifi_api_key: "unifi",
  };

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
    setLogoSource("none");
    if (logoInputRef.current) {
      logoInputRef.current.value = "";
    }
  };

  const copyPortalIp = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(EXTERNAL_PORTAL_IP);
        toast.success("Portal IP copied.");
        return;
      }
    } catch (error) {
      console.error("Clipboard write failed", error);
    }

    let copied = false;
    const input = portalUrlRef.current;
    if (input) {
      input.focus();
      input.select();
      input.setSelectionRange(0, EXTERNAL_PORTAL_IP.length);
      copied = document.execCommand("copy");
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = EXTERNAL_PORTAL_IP;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    if (copied) {
      toast.success("Portal IP copied.");
    } else {
      toast.error("Unable to copy portal IP.");
    }
  };

  const applyTemplatePreset = (preset: keyof typeof TEMPLATE_PRESETS, mode: "replace" | "embed") => {
    setTemplateEditorMode("code");
    siteForm.setValue("portal_template_html", TEMPLATE_PRESETS[preset], { shouldDirty: true });
    siteForm.setValue("portal_template_mode", mode, { shouldDirty: true });
    siteForm.setValue("portal_template_enabled", true, { shouldDirty: true });
    setPortalDesignDirty(true);
  };

  const markPortalDirty = () => {
    setPortalDesignDirty(true);
  };

  const updateTheme = (patch: Partial<PortalTemplateTheme>) => {
    setPortalTheme((prev) => ({ ...prev, ...patch }));
    markPortalDirty();
  };

  const addBuilderBlock = (type: PortalBuilderBlockType) => {
    setBuilderBlocks((prev) => [...prev, defaultBlockForType(type)]);
    markPortalDirty();
  };

  const updateBuilderBlock = (id: string, patch: Partial<PortalBuilderBlock>) => {
    setBuilderBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, ...patch } : block)));
    markPortalDirty();
  };

  const removeBuilderBlock = (id: string) => {
    setBuilderBlocks((prev) => prev.filter((block) => block.id !== id));
    markPortalDirty();
  };

  const moveBuilderBlock = (id: string, direction: "up" | "down") => {
    setBuilderBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index === -1) {
        return prev;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
    markPortalDirty();
  };

  const switchToVisualBuilder = () => {
    const currentHtml = siteForm.getValues("portal_template_html") ?? "";
    const parsed = parseBuilderMeta(currentHtml);
    if (parsed) {
      setBuilderBlocks(parsed);
    } else if (currentHtml.trim()) {
      toast.message("Switched to visual builder. Existing raw HTML remains in code mode.");
    } else {
      const mode = siteForm.getValues("portal_template_mode") ?? "embed";
      setBuilderBlocks(defaultBuilderBlocksForMode(mode));
    }
    setTemplateEditorMode("visual");
  };

  const switchToCodeEditor = () => {
    const mode = siteForm.getValues("portal_template_mode") ?? "off";
    if (templateEditorMode === "visual" && mode !== "off") {
      const generated = buildTemplateFromBlocks(builderBlocks, mode);
      siteForm.setValue("portal_template_html", generated, { shouldDirty: true });
      markPortalDirty();
    }
    setTemplateEditorMode("code");
  };

  const restoreTemplateVersion = async (versionId: string) => {
    if (!tenantId || !params?.id) {
      return;
    }
    setRestoringVersionId(versionId);
    try {
      const data = await apiFetch<{ site: SiteResponseWithTemplate }>(
        `/api/admin/tenants/${tenantId}/sites/${params.id}/portal-template-versions/${versionId}/restore`,
        { method: "POST" }
      );
      const normalizedSite = {
        ...data.site,
        unifi_base_url: displayUnifiHost(data.site.unifi_base_url),
        unifi_port: displayUnifiPort(data.site.unifi_base_url),
        unifi_api_key: "",
        portal_template_mode:
          data.site.portal_template_mode ??
          (data.site.portal_template_enabled
            ? data.site.portal_template_html?.includes("{{portal}}")
              ? "embed"
              : "replace"
            : "off"),
      };
      setSite(normalizedSite);
      siteForm.reset(normalizedSite);
      setPortalTheme(normalizeTemplateTheme(data.site.portal_template_theme));
      syncTemplateEditorFromHtml(
        normalizedSite.portal_template_html ?? "",
        normalizedSite.portal_template_mode ?? "off"
      );
      setPortalDesignDirty(false);
      await loadPortalVersions(portalVersionsOffset);
      toast.success("Template version restored.");
    } catch (err: any) {
      toast.error(err?.message ?? "Unable to restore template version.");
    } finally {
      setRestoringVersionId(null);
    }
  };

  const portalTemplateHtml = siteForm.watch("portal_template_html") ?? "";
  const brandingDisplayName = siteForm.watch("display_name") ?? "Guest WiFi";
  const brandingLogoUrl = siteForm.watch("logo_url") ?? "";
  const brandingPrimaryColor = siteForm.watch("primary_color") ?? "#1f6feb";
  const brandingSupportContact = siteForm.watch("support_contact") ?? "support@example.com";
  const builderTemplateHtml = useMemo(
    () => buildTemplateFromBlocks(builderBlocks, portalTemplateMode),
    [builderBlocks, portalTemplateMode]
  );
  const activeTemplateHtml = templateEditorMode === "visual" ? builderTemplateHtml : portalTemplateHtml;

  const templatePreviewHtml = useMemo(() => {
    const previewSource = stripBuilderMeta(activeTemplateHtml);
    if (!previewSource.trim()) {
      return "";
    }
    return previewSource
      .replaceAll("{{display_name}}", brandingDisplayName)
      .replaceAll("{{logo_url}}", brandingLogoUrl)
      .replaceAll("{{primary_color}}", brandingPrimaryColor)
      .replaceAll("{{support_contact}}", brandingSupportContact)
      .replaceAll("{{portal}}", `<div style="padding:16px;border:1px dashed #94a3b8;border-radius:12px;">Built-in portal card preview</div>`)
      .replaceAll("{{logo_size_px}}", String(portalTheme.logo_size_px ?? 48))
      .replaceAll("{{heading_size_px}}", String(portalTheme.heading_size_px ?? 24))
      .replaceAll("{{body_size_px}}", String(portalTheme.body_size_px ?? 14))
      .replaceAll("{{card_max_width_px}}", String(portalTheme.card_max_width_px ?? 420))
      .replaceAll("{{card_alignment}}", portalTheme.card_alignment ?? "center")
      .replaceAll("{{logo_alignment}}", portalTheme.logo_alignment ?? "left")
      .replaceAll("{{background_color}}", portalTheme.background_color ?? "")
      .replaceAll("{{card_background_color}}", portalTheme.card_background_color ?? "")
      .replaceAll("{{text_color}}", portalTheme.text_color ?? "");
  }, [activeTemplateHtml, brandingDisplayName, brandingLogoUrl, brandingPrimaryColor, brandingSupportContact, portalTheme]);
  const portalVersionsHasPrevious = portalVersionsOffset > 0;
  const portalVersionsHasNext = portalVersionsOffset + PORTAL_VERSION_PAGE_SIZE < portalVersionsTotal;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Site settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {site?.display_name ?? "Branding, policy defaults, and UniFi connection."}
          </p>
        </div>
        <div className="flex gap-2">
          {tenantSlug && site?.slug ? (
            <Button asChild variant="secondary" size="sm">
              <a
                href={`/guest/s/${tenantSlug}/${site.slug}?preview=1`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Preview portal
              </a>
            </Button>
          ) : null}
          <Button
            onClick={async () => {
              const isValid = await siteForm.trigger();
              if (isValid) {
                await saveSite(siteForm.getValues());
              } else {
                const errorKeys = Object.keys(siteForm.formState.errors) as Array<keyof SiteFormValues>;
                const firstErrorKey = errorKeys[0];
                if (firstErrorKey) {
                  setActiveTab(fieldTabs[firstErrorKey]);
                  const element = document.getElementById(firstErrorKey);
                  if (element) {
                    element.scrollIntoView({ behavior: "smooth", block: "center" });
                    element.focus();
                  }
                }
                const errorCount = errorKeys.length;
                const listedErrors = errorKeys.map((key) => fieldLabels[key] ?? key).slice(0, 3);
                const suffix = errorCount > listedErrors.length ? " and more" : "";
                toast.error(
                  `${errorCount} field${errorCount !== 1 ? "s" : ""} have errors: ${listedErrors.join(
                    ", "
                  )}${suffix}.`
                );
              }
            }}
            disabled={!canSave}
            variant="default"
            size="sm"
          >
            Save changes
          </Button>
        </div>
      </div>
      {error && (
        <Alert className="border-destructive/40">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">External portal IP</p>
            <p className="text-xs text-muted-foreground">
              Share this IP with anyone configuring UniFi&apos;s external portal settings.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Input readOnly value={EXTERNAL_PORTAL_IP} ref={portalUrlRef} className="sm:w-[280px]" />
            <Button type="button" variant="secondary" onClick={copyPortalIp}>
              Copy
            </Button>
          </div>
        </div>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="portal">Portal Template</TabsTrigger>
          <TabsTrigger value="policy">Policy Defaults</TabsTrigger>
          <TabsTrigger value="unifi">UniFi Connection</TabsTrigger>
          <TabsTrigger value="oidc">SSO (OIDC)</TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <Card className="rounded-xl border bg-card shadow-soft">
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Guest-facing identity and support info.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="display_name">
                    Display name <span className="text-destructive">*</span>
                  </Label>
                  <Input id="display_name" autoFocus {...siteForm.register("display_name")} />
                  {siteForm.formState.errors.display_name && (
                    <p className="text-xs text-destructive">{siteForm.formState.errors.display_name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">
                    Slug <span className="text-destructive">*</span>
                  </Label>
                  <Input id="slug" {...siteForm.register("slug")} />
                  {siteForm.formState.errors.slug && (
                    <p className="text-xs text-destructive">{siteForm.formState.errors.slug.message}</p>
                  )}
                </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Logo source</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="logo_source"
                    value="upload"
                    checked={logoSource === "upload"}
                    onChange={() => {
                      setLogoSource("upload");
                      siteForm.setValue("logo_url", "", { shouldDirty: true });
                    }}
                  />
                  Upload
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="logo_source"
                    value="url"
                    checked={logoSource === "url"}
                    onChange={() => setLogoSource("url")}
                  />
                  URL
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="logo_source"
                    value="none"
                    checked={logoSource === "none"}
                    onChange={() => clearLogo()}
                  />
                  None
                </label>
              </div>
            </div>
            {logoSource === "upload" && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="logo_upload">Upload image</Label>
                <Input
                  id="logo_upload"
                  type="file"
                  accept="image/*"
                  ref={logoInputRef}
                  onChange={handleLogoUpload}
                />
                <div className="text-xs text-muted-foreground">
                  Uploads are stored as data URLs. Use a small PNG/SVG (max 512KB).
                </div>
                {logoValue ? (
                  <div className="flex items-center gap-3">
                    <img src={logoValue} alt="Logo preview" className="h-12 w-12 rounded-md object-contain" />
                    <span className="text-xs text-muted-foreground">Current logo preview</span>
                  </div>
                ) : null}
              </div>
            )}
            {logoSource === "url" && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="logo_url">Logo URL</Label>
                <Input id="logo_url" placeholder="https://example.com/logo.png" {...siteForm.register("logo_url")} />
                {logoValue ? (
                  <div className="flex items-center gap-3">
                    <img src={logoValue} alt="Logo preview" className="h-12 w-12 rounded-md object-contain" onError={() => {}} />
                    <span className="text-xs text-muted-foreground">Logo preview</span>
                  </div>
                ) : null}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="primary_color">Primary color</Label>
              <div className="flex gap-2">
                <Input id="primary_color" type="color" className="h-10 w-20 cursor-pointer" {...siteForm.register("primary_color")} />
                <Input id="primary_color_text" type="text" placeholder="#1f6feb" {...siteForm.register("primary_color")} />
              </div>
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
                  onChange={() => siteForm.setValue("enabled", !siteForm.getValues("enabled"), { shouldDirty: true })}
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
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="portal">
          <Card className="rounded-xl border bg-card shadow-soft">
            <CardHeader>
              <CardTitle>Portal templating</CardTitle>
              <CardDescription>
                Choose how this site renders its captive portal. Replace mode fully controls markup.
                Embed mode inserts the built-in auth card at {`{{portal}}`}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-6">
                <div className="space-y-2">
                  <Label htmlFor="portal_template_mode">Template mode</Label>
                  <select
                    id="portal_template_mode"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
                    {...siteForm.register("portal_template_mode")}
                    onChange={(event) => {
                      const mode = event.target.value as "off" | "replace" | "embed";
                      siteForm.setValue("portal_template_mode", mode, { shouldDirty: true });
                      siteForm.setValue("portal_template_enabled", mode !== "off", { shouldDirty: true });
                      if (templateEditorMode === "visual" && builderBlocks.length === 0 && mode !== "off") {
                        setBuilderBlocks(defaultBuilderBlocksForMode(mode));
                      }
                      markPortalDirty();
                    }}
                  >
                    <option value="off">Default portal only</option>
                    <option value="embed">Embed built-in portal in custom layout</option>
                    <option value="replace">Replace portal with custom template</option>
                  </select>
                </div>

                <div className="inline-flex rounded-lg border border-border/70 bg-muted/20 p-1">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      templateEditorMode === "visual"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={switchToVisualBuilder}
                  >
                    Visual Builder
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      templateEditorMode === "code"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={switchToCodeEditor}
                  >
                    Code Editor
                  </button>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick presets</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => applyTemplatePreset("splitHero", "embed")}>
                      Hero + embedded card
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => applyTemplatePreset("centeredCard", "embed")}>
                      Centered branded frame
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => applyTemplatePreset("customOnly", "replace")}>
                      Full custom sponsored
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Core tokens: {`{{display_name}}`}, {`{{logo_url}}`}, {`{{primary_color}}`}, {`{{terms_html}}`}, {`{{support_contact}}`}.
                  Theme tokens: {`{{logo_size_px}}`}, {`{{heading_size_px}}`}, {`{{body_size_px}}`}, {`{{card_max_width_px}}`},
                  {` {{card_alignment}}`}, {`{{logo_alignment}}`}, {`{{background_color}}`}, {`{{card_background_color}}`},
                  {` {{text_color}}`}.
                </div>

                {templateEditorMode === "visual" ? (
                  <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => addBuilderBlock("hero")}>
                        Add hero
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => addBuilderBlock("text")}>
                        Add text
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => addBuilderBlock("portal")}>
                        Add portal slot
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => addBuilderBlock("button")}>
                        Add action button
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => addBuilderBlock("spacer")}>
                        Add spacer
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {builderBlocks.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          No blocks added yet. Add sections above to build this portal visually.
                        </div>
                      ) : (
                        builderBlocks.map((block, index) => (
                          <div key={block.id} className="rounded-lg border border-border/70 bg-background p-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold capitalize">
                                {index + 1}. {block.type} block
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => moveBuilderBlock(block.id, "up")}
                                  disabled={index === 0}
                                >
                                  Up
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => moveBuilderBlock(block.id, "down")}
                                  disabled={index === builderBlocks.length - 1}
                                >
                                  Down
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => removeBuilderBlock(block.id)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label>Type</Label>
                                <select
                                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                  value={block.type}
                                  onChange={(event) =>
                                    updateBuilderBlock(block.id, {
                                      ...defaultBlockForType(event.target.value as PortalBuilderBlockType),
                                      id: block.id,
                                    })
                                  }
                                >
                                  <option value="hero">Hero</option>
                                  <option value="text">Text</option>
                                  <option value="portal">Portal slot</option>
                                  <option value="button">Action button</option>
                                  <option value="spacer">Spacer</option>
                                </select>
                              </div>

                              {block.type === "spacer" ? (
                                <div className="space-y-2">
                                  <Label>Height (px)</Label>
                                  <Input
                                    type="number"
                                    min={8}
                                    max={180}
                                    value={block.heightPx ?? 24}
                                    onChange={(event) =>
                                      updateBuilderBlock(block.id, { heightPx: Number(event.target.value || 24) })
                                    }
                                  />
                                </div>
                              ) : null}

                              {(block.type === "hero" || block.type === "text" || block.type === "portal") && (
                                <>
                                  {block.type === "hero" ? (
                                    <div className="space-y-2 md:col-span-2">
                                      <Label>Eyebrow</Label>
                                      <Input
                                        value={block.eyebrow ?? ""}
                                        onChange={(event) => updateBuilderBlock(block.id, { eyebrow: event.target.value })}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="space-y-2 md:col-span-2">
                                    <Label>Title</Label>
                                    <Input
                                      value={block.title ?? ""}
                                      onChange={(event) => updateBuilderBlock(block.id, { title: event.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-2 md:col-span-2">
                                    <Label>Body</Label>
                                    <textarea
                                      className="min-h-[80px] w-full rounded-md border border-input bg-background p-3 text-sm"
                                      value={block.body ?? ""}
                                      onChange={(event) => updateBuilderBlock(block.id, { body: event.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Background color</Label>
                                    <Input
                                      value={block.backgroundColor ?? ""}
                                      placeholder="#0f172a"
                                      onChange={(event) =>
                                        updateBuilderBlock(block.id, { backgroundColor: event.target.value })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Text color</Label>
                                    <Input
                                      value={block.textColor ?? ""}
                                      placeholder="#ffffff"
                                      onChange={(event) => updateBuilderBlock(block.id, { textColor: event.target.value })}
                                    />
                                  </div>
                                </>
                              )}

                              {block.type === "hero" ? (
                                <div className="space-y-2">
                                  <Label>Alignment</Label>
                                  <select
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    value={block.align ?? "left"}
                                    onChange={(event) =>
                                      updateBuilderBlock(block.id, {
                                        align: event.target.value as "left" | "center" | "right",
                                      })
                                    }
                                  >
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                  </select>
                                </div>
                              ) : null}

                              {block.type === "button" ? (
                                <>
                                  <div className="space-y-2 md:col-span-2">
                                    <Label>Button label</Label>
                                    <Input
                                      value={block.buttonLabel ?? ""}
                                      onChange={(event) =>
                                        updateBuilderBlock(block.id, { buttonLabel: event.target.value })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Button color</Label>
                                    <Input
                                      value={block.buttonColor ?? ""}
                                      placeholder="{{primary_color}}"
                                      onChange={(event) =>
                                        updateBuilderBlock(block.id, { buttonColor: event.target.value })
                                      }
                                    />
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="portal_template_html">HTML template</Label>
                    <textarea
                      id="portal_template_html"
                      className="min-h-[220px] w-full rounded-md border border-input bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
                      placeholder="<section>{{portal}}</section>"
                      disabled={!portalTemplateEnabled}
                      {...siteForm.register("portal_template_html")}
                      onChange={(event) => {
                        siteForm.setValue("portal_template_html", event.target.value, { shouldDirty: true });
                        markPortalDirty();
                      }}
                    />
                    {siteForm.formState.errors.portal_template_html && (
                      <p className="text-xs text-destructive">
                        {siteForm.formState.errors.portal_template_html.message as string}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid gap-4 rounded-lg border border-border/70 bg-muted/20 p-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="theme_card_alignment">Card alignment</Label>
                    <select
                      id="theme_card_alignment"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={portalTheme.card_alignment ?? "center"}
                      onChange={(event) => updateTheme({ card_alignment: event.target.value as "left" | "center" | "right" })}
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_logo_alignment">Logo alignment</Label>
                    <select
                      id="theme_logo_alignment"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={portalTheme.logo_alignment ?? "left"}
                      onChange={(event) => updateTheme({ logo_alignment: event.target.value as "left" | "center" | "right" })}
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_card_max_width">Card max width (px)</Label>
                    <Input
                      id="theme_card_max_width"
                      type="number"
                      min={320}
                      max={1024}
                      value={portalTheme.card_max_width_px ?? 420}
                      onChange={(event) => updateTheme({ card_max_width_px: Number(event.target.value || 420) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_logo_size">Logo size (px)</Label>
                    <Input
                      id="theme_logo_size"
                      type="number"
                      min={24}
                      max={240}
                      value={portalTheme.logo_size_px ?? 48}
                      onChange={(event) => updateTheme({ logo_size_px: Number(event.target.value || 48) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_heading_size">Heading size (px)</Label>
                    <Input
                      id="theme_heading_size"
                      type="number"
                      min={18}
                      max={56}
                      value={portalTheme.heading_size_px ?? 24}
                      onChange={(event) => updateTheme({ heading_size_px: Number(event.target.value || 24) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_body_size">Body size (px)</Label>
                    <Input
                      id="theme_body_size"
                      type="number"
                      min={12}
                      max={24}
                      value={portalTheme.body_size_px ?? 14}
                      onChange={(event) => updateTheme({ body_size_px: Number(event.target.value || 14) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_background_color">Background color</Label>
                    <Input
                      id="theme_background_color"
                      placeholder="#f8fafc"
                      value={portalTheme.background_color ?? ""}
                      onChange={(event) => updateTheme({ background_color: event.target.value || undefined })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_card_background_color">Card color</Label>
                    <Input
                      id="theme_card_background_color"
                      placeholder="#ffffff"
                      value={portalTheme.card_background_color ?? ""}
                      onChange={(event) => updateTheme({ card_background_color: event.target.value || undefined })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme_text_color">Text color</Label>
                    <Input
                      id="theme_text_color"
                      placeholder="#0f172a"
                      value={portalTheme.text_color ?? ""}
                      onChange={(event) => updateTheme({ text_color: event.target.value || undefined })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Template preview</Label>
                  <div className="max-h-[360px] overflow-auto rounded-lg border border-border/70 bg-background p-4">
                    {templatePreviewHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: templatePreviewHtml }} />
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Enter template HTML or apply a preset to preview rendering.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Version history</p>
                      <p className="text-xs text-muted-foreground">
                        Automatic snapshots are created whenever portal template settings change.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => loadPortalVersions(portalVersionsOffset)}
                      disabled={portalVersionsLoading}
                    >
                      {portalVersionsLoading ? "Refreshing..." : "Refresh history"}
                    </Button>
                  </div>

                  {portalVersionsLoading ? (
                    <div className="text-sm text-muted-foreground">Loading versions...</div>
                  ) : portalVersions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No saved template versions yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {portalVersions.map((version) => (
                        <div
                          key={version.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-semibold uppercase text-muted-foreground">
                              {version.portal_template_mode} mode
                            </div>
                            <div className="text-sm text-foreground">
                              {new Date(version.created_at).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => restoreTemplateVersion(version.id)}
                            disabled={Boolean(restoringVersionId)}
                          >
                            {restoringVersionId === version.id ? "Restoring..." : "Restore"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {portalVersionsTotal > PORTAL_VERSION_PAGE_SIZE ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <div className="text-xs text-muted-foreground">
                        Showing {portalVersionsOffset + 1}-
                        {Math.min(portalVersionsOffset + portalVersions.length, portalVersionsTotal)} of{" "}
                        {portalVersionsTotal}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            loadPortalVersions(Math.max(0, portalVersionsOffset - PORTAL_VERSION_PAGE_SIZE))
                          }
                          disabled={!portalVersionsHasPrevious || portalVersionsLoading}
                        >
                          Previous
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => loadPortalVersions(portalVersionsOffset + PORTAL_VERSION_PAGE_SIZE)}
                          disabled={!portalVersionsHasNext || portalVersionsLoading}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policy">
          <Card className="rounded-xl border bg-card shadow-soft">
            <CardHeader>
              <CardTitle>Default policy</CardTitle>
              <CardDescription>Applied for voucher and OTP authorization.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 md:grid-cols-2">
                {policyFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <Input id={field.key} type="number" {...siteForm.register(field.key as keyof SiteFormValues)} />
                    {siteForm.formState.errors[field.key as keyof SiteFormValues] && (
                      <p className="text-xs text-destructive">
                        {siteForm.formState.errors[field.key as keyof SiteFormValues]?.message as string}
                      </p>
                    )}
                  </div>
                ))}
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unifi">
          <Card className="rounded-xl border bg-card shadow-soft">
            <CardHeader>
              <CardTitle>UniFi connection</CardTitle>
              <CardDescription>Store controller credentials encrypted in the backend.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="unifi_base_url">UniFi controller IP (optional override)</Label>
                  <Input id="unifi_base_url" placeholder="71.162.143.124" {...siteForm.register("unifi_base_url")} />
                  <p className="text-xs text-muted-foreground">
                    We append {UNIFI_INTEGRATION_PATH} automatically.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_port">UniFi controller port</Label>
                  <Input
                    id="unifi_port"
                    type="number"
                    min={1}
                    max={65535}
                    {...siteForm.register("unifi_port", {
                      setValueAs: (v) => (v === "" || v === null || typeof v === "undefined" ? undefined : Number(v)),
                    })}
                  />
                  <p className="text-xs text-muted-foreground">Defaults to {DEFAULT_UNIFI_PORT}.</p>
                  {siteForm.formState.errors.unifi_port && (
                    <p className="text-xs text-destructive">{siteForm.formState.errors.unifi_port.message as string}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unifi_site_id">UniFi site ID</Label>
                  <Input id="unifi_site_id" {...siteForm.register("unifi_site_id")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="unifi_api_key">UniFi API key (optional override)</Label>
                  <Input id="unifi_api_key" type="password" {...siteForm.register("unifi_api_key")} />
                  <p className="text-xs text-muted-foreground">
                    {site?.unifi_api_key_stored
                      ? "Encrypted key is stored. Leave blank to keep the current value."
                      : "Stored encrypted in the database."}
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
          
          <Card className="mt-6 rounded-xl border bg-card shadow-soft">
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
        </TabsContent>

        <TabsContent value="oidc">
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
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
