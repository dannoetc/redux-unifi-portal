import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL ?? "http://localhost:3000";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";
const adminEmail = process.env.ADMIN_EMAIL ?? "demo-admin@reduxtc.local";
const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
const guestTenant = process.env.GUEST_TENANT ?? "acme";
const guestSite = process.env.GUEST_SITE ?? "lab";
const outputDir = path.resolve(process.cwd(), "..", ".artifacts", "screenshots");

const shots = [];
const issues = [];

const shotPath = (name) => path.join(outputDir, `${name}.png`);

async function capture(page, route, name, opts = {}) {
  const target = route.startsWith("http") ? route : `${baseUrl}${route}`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("body", { timeout: 60_000 });
  if (opts.waitFor) {
    await page.waitForSelector(opts.waitFor, { timeout: 60_000 });
  }
  if (opts.waitForTenant) {
    await page.waitForFunction(
      () => {
        const lock = document.querySelector("#tenant-lock");
        if (lock) {
          return true;
        }
        const select = document.querySelector("#tenant-switcher");
        if (!(select instanceof HTMLSelectElement)) {
          return true;
        }
        const firstLabel = (select.options[0]?.textContent || "").trim().toLowerCase();
        return firstLabel.length > 0 && firstLabel !== "loading tenants...";
      },
      { timeout: 45_000 }
    );
  }
  if (opts.waitForHidden) {
    await page.waitForSelector(opts.waitForHidden, { state: "hidden", timeout: 60_000 });
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: shotPath(name), fullPage: true });
  shots.push(name);
}

async function apiGet(page, path) {
  const response = await page.request.get(`${apiBaseUrl}${path}`, { timeout: 60_000 });
  if (!response.ok()) {
    throw new Error(`API ${response.status()} for ${path}`);
  }
  const payload = await response.json();
  return payload?.data ?? payload;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  page.on("pageerror", (error) => {
    issues.push(`pageerror: ${error.message}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      issues.push(`http ${response.status()} ${response.url()}`);
    }
  });

  await capture(page, "/", "root");
  await capture(page, "/guest", "guest-index");
  await capture(page, `/guest/s/${guestTenant}/${guestSite}?preview=1`, "guest-site-preview");
  await capture(page, "/admin/login", "admin-login");

  await page.fill("#email", adminEmail);
  await page.fill("#password", adminPassword);
  try {
    await Promise.all([
      page.waitForURL("**/admin", { timeout: 60_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
  } catch (error) {
    issues.push("admin login did not navigate to /admin");
    await page.screenshot({ path: shotPath("admin-login-failed"), fullPage: true });
    throw error;
  }

  let tenantId = null;
  let siteId = null;
  try {
    const tenants = await apiGet(page, "/api/admin/tenants");
    tenantId = tenants?.tenants?.[0]?.id ?? null;
    if (tenantId) {
      const siteList = await apiGet(page, `/api/admin/tenants/${tenantId}/sites`);
      siteId = siteList?.sites?.[0]?.id ?? null;
    }
  } catch (error) {
    issues.push(`unable to resolve site detail id: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  await capture(page, "/admin", "admin-dashboard", {
    waitFor: "h1:has-text('Guest Access Operations')",
    waitForTenant: true,
    waitForHidden: ".animate-pulse",
  });
  await capture(page, "/admin/tenants", "admin-tenants", {
    waitFor: "h1:has-text('Tenants')",
    waitForTenant: true,
    waitForHidden: ".animate-pulse",
  });
  await capture(page, "/admin/sites", "admin-sites", {
    waitFor: "h1:has-text('Sites')",
    waitForTenant: true,
    waitForHidden: ".animate-pulse",
  });

  if (tenantId && siteId) {
    await capture(page, `/admin/sites/${siteId}?tenant=${tenantId}`, "admin-site-detail", {
      waitForTenant: true,
    });

    await page.getByRole("tab", { name: "Portal Template" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath("admin-site-detail-portal-tab"), fullPage: true });
    shots.push("admin-site-detail-portal-tab");

    await page.getByRole("tab", { name: "Policy Defaults" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath("admin-site-detail-policy-tab"), fullPage: true });
    shots.push("admin-site-detail-policy-tab");

    await page.getByRole("tab", { name: "UniFi Connection" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath("admin-site-detail-unifi-tab"), fullPage: true });
    shots.push("admin-site-detail-unifi-tab");

    await page.getByRole("tab", { name: "SSO (OIDC)" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath("admin-site-detail-oidc-tab"), fullPage: true });
    shots.push("admin-site-detail-oidc-tab");
  } else {
    issues.push("site detail id not available for screenshot");
  }

  await capture(page, "/admin/admin-users", "admin-users", { waitForTenant: true });
  await capture(page, "/admin/oidc-providers", "admin-oidc-providers", { waitForTenant: true });
  await capture(page, "/admin/vouchers", "admin-vouchers", { waitForTenant: true });
  await capture(page, "/admin/auth-events", "admin-auth-events", {
    waitFor: "h1:has-text('Auth events')",
    waitForTenant: true,
    waitForHidden: ".animate-pulse",
  });
  await capture(page, "/admin/reports", "admin-reports", {
    waitFor: "h1:has-text('Reports')",
    waitForTenant: true,
    waitForHidden: ".animate-pulse",
  });

  await browser.close();

  console.log(`Captured ${shots.length} screenshots in ${outputDir}`);
  for (const shot of shots) {
    console.log(` - ${shot}.png`);
  }

  if (issues.length > 0) {
    console.error("Issues detected during capture:");
    for (const issue of issues) {
      console.error(` - ${issue}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
