import { expect, test, type Page } from "@playwright/test";

type MockSite = {
  id: string;
  display_name: string;
  slug: string;
  enabled: boolean;
  logo_url: string | null;
  primary_color: string | null;
  terms_html: string | null;
  portal_template_html: string | null;
  portal_template_enabled: boolean;
  portal_template_mode: "off" | "embed" | "replace";
  portal_template_theme: Record<string, unknown> | null;
  support_contact: string | null;
  success_url: string | null;
  enable_tos_only: boolean;
  unifi_base_url: string;
  unifi_site_id: string;
  unifi_api_key_ref: string | null;
  unifi_api_key_stored: boolean;
  default_time_limit_minutes: number;
  default_data_limit_mb: number | null;
  default_rx_kbps: number | null;
  default_tx_kbps: number | null;
};

type TemplateVersion = {
  id: string;
  site_id: string;
  tenant_id: string;
  portal_template_mode: "off" | "embed" | "replace";
  portal_template_html: string | null;
  portal_template_theme: Record<string, unknown> | null;
  created_by_admin_user_id: string | null;
  created_at: string;
};

const TENANT_ID = "tenant-1";
const SITE_ID = "site-1";

function buildVersion(site: MockSite, suffix: string): TemplateVersion {
  return {
    id: `ver-${suffix}`,
    site_id: SITE_ID,
    tenant_id: TENANT_ID,
    portal_template_mode: site.portal_template_mode,
    portal_template_html: site.portal_template_html,
    portal_template_theme: site.portal_template_theme,
    created_by_admin_user_id: "admin-1",
    created_at: new Date().toISOString(),
  };
}

async function mockSiteApi(page: Page) {
  const siteState: MockSite = {
    id: SITE_ID,
    display_name: "Lab Site",
    slug: "lab",
    enabled: true,
    logo_url: null,
    primary_color: "#1f6feb",
    terms_html: "<p>Terms</p>",
    portal_template_html: null,
    portal_template_enabled: false,
    portal_template_mode: "off",
    portal_template_theme: {
      card_alignment: "center",
      card_max_width_px: 420,
      logo_size_px: 48,
      logo_alignment: "left",
      heading_size_px: 24,
      body_size_px: 14,
    },
    support_contact: "support@example.com",
    success_url: null,
    enable_tos_only: true,
    unifi_base_url: "https://unifi.example.local/proxy/network/integration",
    unifi_site_id: "default",
    unifi_api_key_ref: "tenant-unifi-key",
    unifi_api_key_stored: true,
    default_time_limit_minutes: 60,
    default_data_limit_mb: null,
    default_rx_kbps: null,
    default_tx_kbps: null,
  };

  const templateVersions: TemplateVersion[] = [];
  let latestUpdateBody: any = null;

  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method().toUpperCase();

    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data }),
      });

    if (path === "/api/admin/me" && method === "GET") {
      return ok({
        admin_user: {
          id: "admin-1",
          email: "admin@example.com",
          is_superadmin: false,
          memberships: [{ tenant_id: TENANT_ID, role: "TENANT_ADMIN" }],
        },
      });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}` && method === "GET") {
      return ok({
        tenant: { id: TENANT_ID, slug: "acme", name: "Acme", status: "ACTIVE" },
      });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}/oidc-providers` && method === "GET") {
      return ok({ providers: [] });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}/sites/${SITE_ID}` && method === "GET") {
      return ok({ site: siteState });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}/sites/${SITE_ID}` && method === "PUT") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      latestUpdateBody = payload;
      siteState.portal_template_mode =
        (payload.portal_template_mode as "off" | "embed" | "replace") ?? siteState.portal_template_mode;
      siteState.portal_template_enabled = siteState.portal_template_mode !== "off";
      siteState.portal_template_html =
        typeof payload.portal_template_html === "string" ? payload.portal_template_html : null;
      siteState.portal_template_theme =
        (payload.portal_template_theme as Record<string, unknown> | null) ?? null;
      templateVersions.unshift(buildVersion(siteState, `${Date.now()}`));
      return ok({ site: siteState });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}/sites/${SITE_ID}/portal-template-versions` && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "10");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const rows = templateVersions.slice(offset, offset + limit);
      return ok({
        versions: rows,
        pagination: {
          limit,
          offset,
          total: templateVersions.length,
          has_more: offset + limit < templateVersions.length,
        },
      });
    }

    if (
      path.startsWith(`/api/admin/tenants/${TENANT_ID}/sites/${SITE_ID}/portal-template-versions/`) &&
      path.endsWith("/restore") &&
      method === "POST"
    ) {
      const versionId = path.split("/").at(-2);
      const target = templateVersions.find((row) => row.id === versionId);
      if (!target) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Version missing." } }),
        });
      }
      siteState.portal_template_mode = target.portal_template_mode;
      siteState.portal_template_enabled = target.portal_template_mode !== "off";
      siteState.portal_template_html = target.portal_template_html;
      siteState.portal_template_theme = target.portal_template_theme;
      templateVersions.unshift(buildVersion(siteState, `restore-${Date.now()}`));
      return ok({ site: siteState, restored_version_id: target.id });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}/sites/${SITE_ID}/oidc` && method === "PUT") {
      return ok({ saved: true });
    }

    if (path === `/api/admin/tenants/${TENANT_ID}/sites/${SITE_ID}/unifi-test` && method === "POST") {
      return ok({ latency_ms: 25, site: { name: "default" } });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: `No mock for ${path}` } }),
    });
  });

  return {
    siteState,
    templateVersions,
    getLatestUpdateBody: () => latestUpdateBody,
  };
}

test("visual builder saves embed mode template and persists on reload", async ({ page }) => {
  const api = await mockSiteApi(page);

  await page.goto(`/admin/sites/${SITE_ID}?tenant=${TENANT_ID}`);
  await expect(page.getByRole("heading", { name: "Site settings" })).toBeVisible();

  await page.getByRole("tab", { name: "Portal Template" }).click();
  await page.locator("#portal_template_mode").selectOption("embed");
  await page.getByRole("button", { name: "Add hero" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => api.getLatestUpdateBody()).not.toBeNull();
  const body = api.getLatestUpdateBody();
  expect(body.portal_template_mode).toBe("embed");
  expect(String(body.portal_template_html)).toContain("{{portal}}");

  await page.reload();
  await page.getByRole("tab", { name: "Portal Template" }).click();
  await expect(page.getByRole("button", { name: "Visual Builder" })).toBeVisible();
  await expect(page.locator("text=portal block")).toHaveCount(1);
});

test("can restore a previous portal template version", async ({ page }) => {
  const api = await mockSiteApi(page);

  api.siteState.portal_template_mode = "embed";
  api.siteState.portal_template_enabled = true;
  api.siteState.portal_template_html = "<section>{{portal}}</section>";
  api.templateVersions.unshift(buildVersion(api.siteState, "embed"));

  api.siteState.portal_template_mode = "replace";
  api.siteState.portal_template_html = "<div id='custom'>Connect now</div>";
  api.templateVersions.unshift(buildVersion(api.siteState, "replace"));

  await page.goto(`/admin/sites/${SITE_ID}?tenant=${TENANT_ID}`);
  await page.getByRole("tab", { name: "Portal Template" }).click();

  await expect(page.getByText("embed mode", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).nth(1).click();

  await expect(page.locator("#portal_template_mode")).toHaveValue("embed");
  await expect.poll(() => api.siteState.portal_template_mode).toBe("embed");
});
