"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { ApiError, apiDownloadCsv, apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataErrorState, TenantOnboardingState, TenantSelectionState } from "@/components/admin/page-states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MethodDailyRow = {
  day: string;
  method: string;
  attempts: number;
  success: number;
  fail: number;
  success_rate: number;
};

type MethodDailyReport = {
  rows: MethodDailyRow[];
};

type SiteComparisonRow = {
  site_id: string;
  site_name: string;
  auth_attempts: number;
  auth_success: number;
  auth_fail: number;
  success_rate: number;
  voucher_redemptions: number;
  tos_clicks: number;
};

type SiteComparisonReport = {
  rows: SiteComparisonRow[];
};

type Site = {
  id: string;
  display_name: string;
};

type SiteList = { sites: Site[] };

type ReportFilters = {
  days: number;
  siteId: string;
  method: string;
};

type TenantScope = "selected" | "all";

type FilterPreset = {
  id: string;
  name: string;
  filters: ReportFilters;
  updatedAt: string;
};

const DEFAULT_FILTERS: ReportFilters = { days: 30, siteId: "", method: "" };
const PERIOD_OPTIONS = [7, 30, 90];
const METHOD_OPTIONS = ["", "voucher", "email_otp", "oidc", "tos_only"] as const;
const MAX_PRESETS = 20;

function isValidMethod(value: string): value is (typeof METHOD_OPTIONS)[number] {
  return METHOD_OPTIONS.includes(value as (typeof METHOD_OPTIONS)[number]);
}

function methodLabel(value: string) {
  if (!value) {
    return "All methods";
  }
  if (value === "email_otp") {
    return "Email OTP";
  }
  if (value === "tos_only") {
    return "TOS only";
  }
  if (value === "oidc") {
    return "OIDC";
  }
  return "Voucher";
}

function storageKey(tenantId: string) {
  return `redux_unifi_report_filters:${tenantId}`;
}

function presetsStorageKey(tenantId: string) {
  return `redux_unifi_report_presets:${tenantId}`;
}

function filtersEqual(a: ReportFilters, b: ReportFilters) {
  return a.days === b.days && a.siteId === b.siteId && a.method === b.method;
}

function createPresetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeFilters(filters: ReportFilters, sites: Site[]): ReportFilters {
  const days = PERIOD_OPTIONS.includes(filters.days) ? filters.days : DEFAULT_FILTERS.days;
  const method = isValidMethod(filters.method) ? filters.method : "";
  const siteId = filters.siteId && sites.some((site) => site.id === filters.siteId) ? filters.siteId : "";
  return { days, method, siteId };
}

function parseStoredFilters(raw: string | null): ReportFilters {
  if (!raw) {
    return DEFAULT_FILTERS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReportFilters>;
    const days = PERIOD_OPTIONS.includes(parsed.days ?? 0) ? (parsed.days as number) : DEFAULT_FILTERS.days;
    const siteId = typeof parsed.siteId === "string" ? parsed.siteId : "";
    const method = typeof parsed.method === "string" && isValidMethod(parsed.method) ? parsed.method : "";
    return { days, siteId, method };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function reportParams(filters: ReportFilters) {
  const params = new URLSearchParams({ days: String(filters.days) });
  if (filters.siteId) {
    params.set("site_id", filters.siteId);
  }
  if (filters.method) {
    params.set("method", filters.method);
  }
  return params;
}

function parseStoredPresets(raw: string | null, sites: Site[]): FilterPreset[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized: FilterPreset[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as Partial<FilterPreset>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.name !== "string" ||
        !candidate.filters ||
        typeof candidate.filters !== "object"
      ) {
        continue;
      }
      const incomingFilters = candidate.filters as ReportFilters;
      const sanitized = sanitizeFilters(incomingFilters, sites);
      normalized.push({
        id: candidate.id,
        name: candidate.name.trim(),
        filters: sanitized,
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
      });
    }
    return normalized.filter((preset) => preset.name.length > 0).slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

export default function ReportsPage() {
  const router = useRouter();
  const { tenantId, tenants, adminUser, loading: tenantLoading } = useTenantSelection();
  const [sites, setSites] = useState<Site[]>([]);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [tenantScope, setTenantScope] = useState<TenantScope>("selected");
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scopeReloadToken, setScopeReloadToken] = useState(0);
  const [methodDailyRows, setMethodDailyRows] = useState<MethodDailyRow[]>([]);
  const [siteRows, setSiteRows] = useState<SiteComparisonRow[]>([]);
  const [methodPage, setMethodPage] = useState(1);
  const [methodPageSize, setMethodPageSize] = useState(25);
  const [sitePage, setSitePage] = useState(1);
  const [sitePageSize, setSitePageSize] = useState(10);

  const activeTenant = tenants.find((tenant) => tenant.id === tenantId) ?? null;
  const canUseAllTenants = Boolean(adminUser?.is_superadmin && tenants.length > 1);
  const noTenants = !tenantLoading && tenants.length === 0;
  const viewingAllTenants = canUseAllTenants && tenantScope === "all";
  const scopeStorageId = viewingAllTenants ? "__all__" : tenantId;
  const hasScope = Boolean(scopeStorageId);

  useEffect(() => {
    if (!canUseAllTenants && tenantScope !== "selected") {
      setTenantScope("selected");
    }
  }, [canUseAllTenants, tenantScope]);

  useEffect(() => {
    if (!scopeStorageId) {
      setSites([]);
      setFilters(DEFAULT_FILTERS);
      setPresets([]);
      setActivePresetId("");
      setPresetName("");
      setHydrated(false);
      setScopeError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setHydrated(false);
    setScopeError(null);
    const siteOptionsEndpoint = viewingAllTenants ? "/api/admin/sites/options" : `/api/admin/tenants/${tenantId}/sites`;
    apiFetch<SiteList>(siteOptionsEndpoint)
      .then((data) => {
        if (!active) {
          return;
        }
        setSites(data.sites);
        const stored =
          typeof window !== "undefined"
            ? parseStoredFilters(window.localStorage.getItem(storageKey(scopeStorageId)))
            : DEFAULT_FILTERS;
        const sanitizedFilters = sanitizeFilters(stored, data.sites);
        setFilters(sanitizedFilters);
        const storedPresets =
          typeof window !== "undefined"
            ? parseStoredPresets(window.localStorage.getItem(presetsStorageKey(scopeStorageId)), data.sites)
            : [];
        setPresets(storedPresets);
        const matchingPreset = storedPresets.find((preset) => filtersEqual(preset.filters, sanitizedFilters));
        setActivePresetId(matchingPreset?.id ?? "");
        setPresetName(matchingPreset?.name ?? "");
        setHydrated(true);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/admin/login");
          return;
        }
        const message = error?.message ?? "Unable to load report site options.";
        setScopeError(message);
        toast.error(message);
        setPresets([]);
        setActivePresetId("");
        setPresetName("");
        setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [router, scopeReloadToken, scopeStorageId, tenantId, viewingAllTenants]);

  useEffect(() => {
    if (!scopeStorageId || !hydrated) {
      return;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(scopeStorageId), JSON.stringify(filters));
      window.localStorage.setItem(presetsStorageKey(scopeStorageId), JSON.stringify(presets));
    }
  }, [filters, hydrated, presets, scopeStorageId]);

  const applyPreset = (presetId: string) => {
    if (!presetId) {
      setActivePresetId("");
      setPresetName("");
      return;
    }
    const preset = presets.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }
    setActivePresetId(preset.id);
    setPresetName(preset.name);
    setFilters(preset.filters);
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (name.length < 2) {
      toast.error("Preset name must be at least 2 characters.");
      return;
    }
    const now = new Date().toISOString();
    const existingByName = presets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const targetId = activePresetId || existingByName?.id || createPresetId();
    const nextPreset: FilterPreset = {
      id: targetId,
      name,
      filters,
      updatedAt: now,
    };
    const next = [nextPreset, ...presets.filter((preset) => preset.id !== targetId)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_PRESETS);
    setPresets(next);
    setActivePresetId(targetId);
    setPresetName(name);
    toast.success("Report preset saved.");
  };

  const deletePreset = () => {
    if (!activePresetId) {
      return;
    }
    setPresets((prev) => prev.filter((preset) => preset.id !== activePresetId));
    setActivePresetId("");
    setPresetName("");
    toast.success("Report preset deleted.");
  };

  const loadReports = async () => {
    if (!scopeStorageId || !hydrated) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    const params = reportParams(filters).toString();
    try {
      const methodEndpoint = viewingAllTenants
        ? `/api/admin/reports/method-daily?${params}`
        : `/api/admin/tenants/${tenantId}/reports/method-daily?${params}`;
      const siteEndpoint = viewingAllTenants
        ? `/api/admin/reports/site-comparison?${params}`
        : `/api/admin/tenants/${tenantId}/reports/site-comparison?${params}`;
      const [methodDaily, siteComparison] = await Promise.all([
        apiFetch<MethodDailyReport>(methodEndpoint),
        apiFetch<SiteComparisonReport>(siteEndpoint),
      ]);
      setMethodDailyRows(methodDaily.rows);
      setSiteRows(siteComparison.rows);
      setLoadError(null);
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const message = error?.message ?? "Unable to load reporting data.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [filters, hydrated, scopeStorageId, tenantId, viewingAllTenants]);

  useEffect(() => {
    setMethodPage(1);
    setSitePage(1);
  }, [filters, tenantScope, scopeStorageId]);

  const exportMethodDaily = async () => {
    if (!scopeStorageId) {
      return;
    }
    const params = reportParams(filters).toString();
    try {
      const endpoint = viewingAllTenants
        ? `/api/admin/reports/method-daily/export.csv?${params}`
        : `/api/admin/tenants/${tenantId}/reports/method-daily/export.csv?${params}`;
      await apiDownloadCsv(
        endpoint,
        "method-daily-report.csv"
      );
      toast.success("Method daily CSV exported.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to export method daily report.");
    }
  };

  const exportSiteComparison = async () => {
    if (!scopeStorageId) {
      return;
    }
    const params = reportParams(filters).toString();
    try {
      const endpoint = viewingAllTenants
        ? `/api/admin/reports/site-comparison/export.csv?${params}`
        : `/api/admin/tenants/${tenantId}/reports/site-comparison/export.csv?${params}`;
      await apiDownloadCsv(
        endpoint,
        "site-comparison-report.csv"
      );
      toast.success("Site comparison CSV exported.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to export site comparison report.");
    }
  };

  const totalAttempts = useMemo(
    () => siteRows.reduce((sum, row) => sum + row.auth_attempts, 0),
    [siteRows]
  );
  const totalSuccess = useMemo(
    () => siteRows.reduce((sum, row) => sum + row.auth_success, 0),
    [siteRows]
  );
  const visibleMethodDailyRows = useMemo(
    () => methodDailyRows.filter((row) => row.attempts > 0 || row.success > 0 || row.fail > 0),
    [methodDailyRows]
  );
  const methodPageCount = Math.max(1, Math.ceil(visibleMethodDailyRows.length / methodPageSize));
  const sitePageCount = Math.max(1, Math.ceil(siteRows.length / sitePageSize));
  const pagedMethodDailyRows = useMemo(() => {
    const start = (methodPage - 1) * methodPageSize;
    return visibleMethodDailyRows.slice(start, start + methodPageSize);
  }, [methodPage, methodPageSize, visibleMethodDailyRows]);
  const pagedSiteRows = useMemo(() => {
    const start = (sitePage - 1) * sitePageSize;
    return siteRows.slice(start, start + sitePageSize);
  }, [sitePage, sitePageSize, siteRows]);

  useEffect(() => {
    if (methodPage > methodPageCount) {
      setMethodPage(methodPageCount);
    }
  }, [methodPage, methodPageCount]);

  useEffect(() => {
    if (sitePage > sitePageCount) {
      setSitePage(sitePageCount);
    }
  }, [sitePage, sitePageCount]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare site performance and authentication trends with exportable views.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {viewingAllTenants
              ? "Scope: all tenants"
              : activeTenant
                ? `Active tenant: ${activeTenant.name}`
                : "Select a tenant from the sidebar to continue."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Filters are saved per scope on this browser.
          </p>
        </div>
        <Button variant="secondary" onClick={loadReports} disabled={loading || !scopeStorageId || !hydrated}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {canUseAllTenants ? (
        <div className="inline-flex rounded-lg border border-border/80 bg-background/80 p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              !viewingAllTenants ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTenantScope("selected")}
          >
            Selected tenant
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              viewingAllTenants ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTenantScope("all")}
          >
            All tenants
          </button>
        </div>
      ) : null}

      {noTenants ? (
        <TenantOnboardingState />
      ) : !scopeStorageId ? (
        <TenantSelectionState message="Select a tenant to load reports." />
      ) : null}
      {scopeError && hasScope ? (
        <DataErrorState
          title="Unable to load report options."
          message={scopeError}
          onRetry={() => setScopeReloadToken((current) => current + 1)}
        />
      ) : null}
      {loadError && hasScope ? (
        <DataErrorState
          title="Unable to refresh report data."
          message={loadError}
          onRetry={loadReports}
        />
      ) : null}

      {hasScope ? (
      <>
      <Card className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
        <div className="grid gap-4 border-b border-border/70 pb-4 md:grid-cols-[1fr_1fr_auto_auto]">
          <div className="space-y-2">
            <Label htmlFor="saved_preset">Saved preset</Label>
            <select
              id="saved_preset"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              value={activePresetId}
              onChange={(event) => applyPreset(event.target.value)}
            >
              <option value="">Select preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="preset_name">Preset name</Label>
            <Input
              id="preset_name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Weekly voucher check"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={savePreset} disabled={!scopeStorageId || !hydrated}>
              Save preset
            </Button>
          </div>
          <div className="flex items-end">
            <Button variant="secondary" onClick={deletePreset} disabled={!activePresetId}>
              Delete preset
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="period">Period</Label>
            <select
              id="period"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              value={filters.days}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, days: Number(event.target.value) as 7 | 30 | 90 }))
              }
            >
              {PERIOD_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  Last {days} days
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="site">Site</Label>
            <select
              id="site"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              value={filters.siteId}
              onChange={(event) => setFilters((prev) => ({ ...prev, siteId: event.target.value }))}
            >
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Method</Label>
            <select
              id="method"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              value={filters.method}
              onChange={(event) => setFilters((prev) => ({ ...prev, method: event.target.value }))}
            >
              <option value="">All methods</option>
              <option value="voucher">Voucher</option>
              <option value="email_otp">Email OTP</option>
              <option value="oidc">OIDC</option>
              <option value="tos_only">TOS only</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auth attempts</p>
          <p className="mt-2 text-2xl font-semibold">{totalAttempts.toLocaleString()}</p>
        </Card>
        <Card className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auth success</p>
          <p className="mt-2 text-2xl font-semibold">{totalSuccess.toLocaleString()}</p>
        </Card>
        <Card className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Method scope</p>
          <p className="mt-2 text-2xl font-semibold">{methodLabel(filters.method)}</p>
        </Card>
      </div>

      <Card className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Method Daily Trend</h2>
            <p className="text-xs text-muted-foreground">
              Attempts and conversion by day for selected method scope.
              {methodDailyRows.length > visibleMethodDailyRows.length
                ? ` Showing ${visibleMethodDailyRows.length} active rows.`
                : ""}
            </p>
          </div>
          <Button variant="secondary" onClick={exportMethodDaily} disabled={!scopeStorageId}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card/95">
              <tr className="border-b border-border/80 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-left font-semibold">Day</th>
                <th className="px-2 py-2 text-left font-semibold">Method</th>
                <th className="px-2 py-2 text-right font-semibold">Attempts</th>
                <th className="px-2 py-2 text-right font-semibold">Success</th>
                <th className="px-2 py-2 text-right font-semibold">Fail</th>
                <th className="px-2 py-2 text-right font-semibold">Success rate</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-sm text-muted-foreground">
                    Loading report...
                  </td>
                </tr>
              ) : visibleMethodDailyRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-sm text-muted-foreground">
                    No data for current filters.
                  </td>
                </tr>
              ) : (
                pagedMethodDailyRows.map((row) => (
                  <tr key={`${row.day}-${row.method}`} className="border-b border-border/50">
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-foreground">
                      {new Date(row.day).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{methodLabel(row.method)}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.attempts}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.success}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.fail}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                      {row.success_rate.toFixed(2)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && visibleMethodDailyRows.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              Showing {Math.min((methodPage - 1) * methodPageSize + 1, visibleMethodDailyRows.length)}-
              {Math.min(methodPage * methodPageSize, visibleMethodDailyRows.length)} of {visibleMethodDailyRows.length}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={methodPageSize}
                onChange={(event) => {
                  setMethodPageSize(Number(event.target.value));
                  setMethodPage(1);
                }}
              >
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMethodPage((current) => Math.max(1, current - 1))}
                disabled={methodPage <= 1}
              >
                Previous
              </Button>
              <div className="text-xs text-muted-foreground">
                Page {methodPage} of {methodPageCount}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMethodPage((current) => Math.min(methodPageCount, current + 1))}
                disabled={methodPage >= methodPageCount}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Site Comparison</h2>
            <p className="text-xs text-muted-foreground">
              Side-by-side site performance including voucher and TOS click-through traffic.
            </p>
          </div>
          <Button variant="secondary" onClick={exportSiteComparison} disabled={!scopeStorageId}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card/95">
              <tr className="border-b border-border/80 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-left font-semibold">Site</th>
                <th className="px-2 py-2 text-right font-semibold">Attempts</th>
                <th className="px-2 py-2 text-right font-semibold">Success</th>
                <th className="px-2 py-2 text-right font-semibold">Fail</th>
                <th className="px-2 py-2 text-right font-semibold">Success rate</th>
                <th className="px-2 py-2 text-right font-semibold">Vouchers</th>
                <th className="px-2 py-2 text-right font-semibold">TOS clicks</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-sm text-muted-foreground">
                    Loading report...
                  </td>
                </tr>
              ) : siteRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-sm text-muted-foreground">
                    No data for current filters.
                  </td>
                </tr>
              ) : (
                pagedSiteRows.map((row) => (
                  <tr key={row.site_id} className="border-b border-border/50">
                    <td className="px-2 py-2 text-xs font-semibold text-foreground">{row.site_name}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.auth_attempts}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.auth_success}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.auth_fail}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                      {row.success_rate.toFixed(2)}%
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.voucher_redemptions}</td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{row.tos_clicks}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && siteRows.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              Showing {Math.min((sitePage - 1) * sitePageSize + 1, siteRows.length)}-
              {Math.min(sitePage * sitePageSize, siteRows.length)} of {siteRows.length}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={sitePageSize}
                onChange={(event) => {
                  setSitePageSize(Number(event.target.value));
                  setSitePage(1);
                }}
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSitePage((current) => Math.max(1, current - 1))}
                disabled={sitePage <= 1}
              >
                Previous
              </Button>
              <div className="text-xs text-muted-foreground">
                Page {sitePage} of {sitePageCount}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSitePage((current) => Math.min(sitePageCount, current + 1))}
                disabled={sitePage >= sitePageCount}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      </>
      ) : null}
    </div>
  );
}
