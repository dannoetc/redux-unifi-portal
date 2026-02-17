"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  DoorOpen,
  Ticket,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError, apiFetch } from "@/lib/api";
import { useTenantSelection } from "@/lib/use-tenant";
import { DataErrorState, TenantOnboardingState, TenantSelectionState } from "@/components/admin/page-states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PopoverMenu, PopoverMenuItem } from "@/components/ui/PopoverMenu";

type DashboardOverview = {
  sessions_started: number;
  sessions_authorized: number;
  sessions_failed: number;
  auth_attempts: number;
  auth_success: number;
  auth_fail: number;
  success_rate: number;
  voucher_redemptions: number;
  tos_clicks: number;
};

type DashboardMethod = {
  method: string;
  attempts: number;
  success: number;
  fail: number;
  success_rate: number;
};

type DashboardDailyPoint = {
  day: string;
  sessions_started: number;
  sessions_authorized: number;
  sessions_failed: number;
  auth_attempts: number;
  auth_success: number;
  auth_fail: number;
  voucher_redemptions: number;
  tos_clicks: number;
  otp_success: number;
  oidc_success: number;
};

type DashboardSite = {
  site_id: string;
  site_name: string;
  sessions_started: number;
  auth_attempts: number;
  auth_success: number;
  voucher_redemptions: number;
  tos_clicks: number;
  success_rate: number;
};

type DashboardSummary = {
  period_days: number;
  site_id: string | null;
  window_start: string;
  window_end: string;
  generated_at: string;
  overview: DashboardOverview;
  methods: DashboardMethod[];
  daily: DashboardDailyPoint[];
  sites: DashboardSite[];
  site_options: { id: string; display_name: string }[];
};

const PERIOD_OPTIONS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

function methodLabel(method: string) {
  switch (method) {
    case "voucher":
      return "Voucher";
    case "email_otp":
      return "Email OTP";
    case "oidc":
      return "OIDC";
    case "tos_only":
      return "TOS only";
    default:
      return method.replaceAll("_", " ");
  }
}

function buildAuthEventsHref(filters: {
  method?: string;
  result?: string;
  siteId?: string;
  search?: string;
  scope?: "all";
}) {
  const params = new URLSearchParams();
  if (filters.method) {
    params.set("method", filters.method);
  }
  if (filters.result) {
    params.set("result", filters.result);
  }
  if (filters.siteId) {
    params.set("site_id", filters.siteId);
  }
  if (filters.search) {
    params.set("search", filters.search);
  }
  if (filters.scope === "all") {
    params.set("scope", "all");
  }
  const query = params.toString();
  return query ? `/admin/auth-events?${query}` : "/admin/auth-events";
}

function buildVouchersHref(filters: { siteId?: string }) {
  if (!filters.siteId) {
    return "/admin/vouchers";
  }
  const params = new URLSearchParams({ site_id: filters.siteId });
  return `/admin/vouchers?${params.toString()}`;
}

function StatCard({
  icon,
  label,
  value,
  hint,
  actionLabel,
  actionHref,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <Card className="rounded-xl border border-border/80 bg-card/95 p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
          {actionLabel && actionHref ? (
            <Link
              href={actionHref}
              className="inline-flex pt-1 text-xs font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
            >
              {actionLabel}
            </Link>
          ) : null}
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-muted-foreground">{icon}</div>
      </div>
    </Card>
  );
}

export default function AdminHomePage() {
  const router = useRouter();
  const { tenantId, tenants, loading: tenantLoading, adminUser } = useTenantSelection();
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [tenantScope, setTenantScope] = useState<"selected" | "all">("selected");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dailyPage, setDailyPage] = useState(1);
  const [dailyPageSize, setDailyPageSize] = useState(15);

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    [tenantId, tenants]
  );
  const canUseAllTenants = Boolean(adminUser?.is_superadmin && tenants.length > 1);
  const noTenants = !tenantLoading && tenants.length === 0;
  const viewingAllTenants = canUseAllTenants && tenantScope === "all";

  useEffect(() => {
    if (!canUseAllTenants && tenantScope !== "selected") {
      setTenantScope("selected");
    }
  }, [canUseAllTenants, tenantScope]);

  useEffect(() => {
    setSiteFilter("all");
  }, [tenantId, tenantScope]);

  useEffect(() => {
    if (!viewingAllTenants && !tenantId) {
      setSummary(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ days: String(periodDays) });
    if (siteFilter !== "all") {
      params.set("site_id", siteFilter);
    }

    const endpoint = viewingAllTenants
      ? `/api/admin/dashboard/summary?${params.toString()}`
      : `/api/admin/tenants/${tenantId}/dashboard/summary?${params.toString()}`;

    apiFetch<DashboardSummary>(endpoint)
      .then((data) => {
        if (!active) {
          return;
        }
        setSummary(data);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/admin/login");
          return;
        }
        const message = error?.message ?? "Unable to load dashboard metrics.";
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [periodDays, reloadToken, router, siteFilter, tenantId, viewingAllTenants]);

  useEffect(() => {
    if (!summary) {
      return;
    }
    if (siteFilter !== "all" && !summary.site_options.some((site) => site.id === siteFilter)) {
      setSiteFilter("all");
    }
  }, [siteFilter, summary]);

  useEffect(() => {
    setDailyPage(1);
  }, [periodDays, siteFilter, tenantId, tenantScope]);

  const selectedSiteLabel = useMemo(() => {
    if (!summary || siteFilter === "all") {
      return "All sites";
    }
    const selected = summary.site_options.find((site) => site.id === siteFilter);
    return selected?.display_name ?? "All sites";
  }, [siteFilter, summary]);

  const visibleMethods = useMemo(
    () => (summary?.methods ?? []).filter((item) => item.attempts > 0),
    [summary]
  );
  const visibleDailyRows = useMemo(() => {
    if (!summary) {
      return [];
    }
    const activeRows = summary.daily.filter(
      (item) =>
        item.sessions_started > 0 ||
        item.auth_attempts > 0 ||
        item.auth_success > 0 ||
        item.voucher_redemptions > 0 ||
        item.tos_clicks > 0
    );
    if (activeRows.length > 0) {
      return activeRows;
    }
    return summary.daily.slice(-7);
  }, [summary]);
  const dailyMax = useMemo(() => {
    if (visibleDailyRows.length === 0) {
      return 1;
    }
    return Math.max(...visibleDailyRows.map((item) => item.auth_attempts), 1);
  }, [visibleDailyRows]);
  const dailyPageCount = Math.max(1, Math.ceil(visibleDailyRows.length / dailyPageSize));
  const pagedDailyRows = useMemo(() => {
    const start = (dailyPage - 1) * dailyPageSize;
    return visibleDailyRows.slice(start, start + dailyPageSize);
  }, [dailyPage, dailyPageSize, visibleDailyRows]);

  useEffect(() => {
    if (dailyPage > dailyPageCount) {
      setDailyPage(dailyPageCount);
    }
  }, [dailyPage, dailyPageCount]);
  const topSites = useMemo(() => (summary?.sites ?? []).slice(0, 6), [summary]);
  const selectedSiteId = siteFilter !== "all" ? siteFilter : undefined;
  const showLoading = tenantLoading || ((Boolean(tenantId) || viewingAllTenants) && loading);
  const authEventsScope = viewingAllTenants ? "all" : undefined;
  const authEventsHref = useMemo(
    () => buildAuthEventsHref({ siteId: selectedSiteId, scope: authEventsScope }),
    [authEventsScope, selectedSiteId]
  );
  const vouchersHref = useMemo(
    () => buildVouchersHref({ siteId: selectedSiteId }),
    [selectedSiteId]
  );

  return (
    <div className="space-y-6">
      <Card className="surface-grid rounded-2xl border border-border/80 bg-card/95 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Admin dashboard
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Guest Access Operations
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeTenant
                ? viewingAllTenants
                  ? "Scope: all tenants"
                  : `Tenant: ${activeTenant.name}`
                : "Select a tenant from the sidebar to view usage and auth flow performance."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setReloadToken((current) => current + 1)}
              disabled={showLoading || (!tenantId && !viewingAllTenants)}
            >
              Refresh
            </Button>
            <Button asChild variant="secondary">
              <Link href={authEventsHref}>View auth events</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={vouchersHref}>Manage vouchers</Link>
            </Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-border/80 bg-background/80 p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  option.value === periodDays
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setPeriodDays(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {canUseAllTenants ? (
            <div className="inline-flex rounded-lg border border-border/80 bg-background/80 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  !viewingAllTenants
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setTenantScope("selected")}
              >
                Selected tenant
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  viewingAllTenants
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setTenantScope("all")}
              >
                All tenants
              </button>
            </div>
          ) : null}
          <PopoverMenu
            trigger={
              <Button variant="secondary" className="h-9 text-xs font-semibold">
                {selectedSiteLabel}
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            }
            align="start"
            contentClassName="min-w-[220px]"
          >
            <PopoverMenuItem onClick={() => setSiteFilter("all")}>All sites</PopoverMenuItem>
            {(summary?.site_options ?? []).map((site) => (
              <PopoverMenuItem key={site.id} onClick={() => setSiteFilter(site.id)}>
                {site.display_name}
              </PopoverMenuItem>
            ))}
          </PopoverMenu>
          {summary ? (
            <p className="text-xs text-muted-foreground">
              Window: {new Date(summary.window_start).toLocaleDateString()} to{" "}
              {new Date(summary.window_end).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </Card>
      {loadError ? (
        <DataErrorState
          title="Unable to refresh dashboard metrics."
          message={loadError}
          onRetry={() => setReloadToken((current) => current + 1)}
        />
      ) : null}

      {showLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={`dashboard-loading-${index}`} className="h-[132px] animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : noTenants ? (
        <TenantOnboardingState />
      ) : !tenantId && !viewingAllTenants ? (
        <TenantSelectionState message="Select a tenant to load dashboard analytics." />
      ) : !summary ? (
        <Card className="rounded-xl border border-border/80 bg-card/95 p-6 shadow-soft">
          <p className="text-sm text-muted-foreground">No dashboard data is available yet.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatCard
              icon={<CircleDashed className="h-4 w-4" aria-hidden="true" />}
              label="Sessions Started"
              value={summary.overview.sessions_started.toLocaleString()}
              hint={`${summary.overview.auth_attempts.toLocaleString()} auth attempts`}
              actionLabel="Open auth events"
              actionHref={buildAuthEventsHref({ siteId: selectedSiteId, scope: authEventsScope })}
            />
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              label="Authorized"
              value={summary.overview.auth_success.toLocaleString()}
              hint={`${summary.overview.sessions_authorized.toLocaleString()} sessions marked authorized`}
              actionLabel="View successful auth"
              actionHref={buildAuthEventsHref({ siteId: selectedSiteId, result: "success", scope: authEventsScope })}
            />
            <StatCard
              icon={<Activity className="h-4 w-4" aria-hidden="true" />}
              label="Success Rate"
              value={`${summary.overview.success_rate.toFixed(2)}%`}
              hint={`${summary.overview.auth_fail.toLocaleString()} failed auth attempts`}
            />
            <StatCard
              icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
              label="Vouchers Used"
              value={summary.overview.voucher_redemptions.toLocaleString()}
              hint="Redemptions recorded in period"
              actionLabel="Review voucher auth"
              actionHref={buildAuthEventsHref({
                siteId: selectedSiteId,
                method: "voucher",
                result: "success",
                scope: authEventsScope,
              })}
            />
            <StatCard
              icon={<DoorOpen className="h-4 w-4" aria-hidden="true" />}
              label="TOS Click-Through"
              value={summary.overview.tos_clicks.toLocaleString()}
              hint="Successful TOS-only authorizations"
              actionLabel="Inspect TOS events"
              actionHref={buildAuthEventsHref({
                siteId: selectedSiteId,
                method: "tos_only",
                result: "success",
                scope: authEventsScope,
              })}
            />
            <StatCard
              icon={<XCircle className="h-4 w-4" aria-hidden="true" />}
              label="Failed Sessions"
              value={summary.overview.sessions_failed.toLocaleString()}
              hint={`${summary.overview.auth_fail.toLocaleString()} auth failures`}
              actionLabel="Investigate failures"
              actionHref={buildAuthEventsHref({ siteId: selectedSiteId, result: "fail", scope: authEventsScope })}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <Card className="rounded-xl border border-border/80 bg-card/95 p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Authentication mix</h2>
                  <p className="text-xs text-muted-foreground">
                    Method-level usage and conversion for the selected window.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {visibleMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No authentication events in this period.</p>
                ) : (
                  visibleMethods.map((method) => (
                    <div key={method.method} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{methodLabel(method.method)}</p>
                        <p className="text-xs text-muted-foreground">
                          {method.success} success / {method.fail} fail
                        </p>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted/60">
                        <div
                          className="h-2 rounded-full bg-foreground/80 transition-all"
                          style={{ width: `${Math.max(4, method.success_rate)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{method.attempts} attempts</span>
                        <div className="flex items-center gap-3">
                          <span>{method.success_rate.toFixed(2)}% success</span>
                          <Link
                            href={buildAuthEventsHref({
                              siteId: selectedSiteId,
                              method: method.method,
                              scope: authEventsScope,
                            })}
                            className="font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                          >
                            Details
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="rounded-xl border border-border/80 bg-card/95 p-5 shadow-soft">
              <h2 className="text-base font-semibold">Site performance</h2>
              <p className="text-xs text-muted-foreground">
                Ranked by successful authentications.
              </p>
              <div className="mt-4 space-y-3">
                {topSites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No site activity in this period.</p>
                ) : (
                  topSites.map((site) => (
                    <div key={site.site_id} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{site.site_name}</p>
                        <p className="text-xs text-muted-foreground">{site.success_rate.toFixed(2)}% success</p>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>{site.sessions_started} sessions</span>
                        <span>{site.auth_attempts} attempts</span>
                        <span>{site.voucher_redemptions} vouchers</span>
                      </div>
                      <div className="mt-2 flex items-center justify-end">
                        <Link
                          href={buildAuthEventsHref({ siteId: site.site_id, scope: authEventsScope })}
                          className="text-xs font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                        >
                          View site events
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <Card className="rounded-xl border border-border/80 bg-card/95 p-5 shadow-soft">
            <h2 className="text-base font-semibold">Daily traffic and click-through</h2>
            <p className="text-xs text-muted-foreground">
              Sessions, auth outcomes, voucher usage, and TOS clicks by day.
              {summary.daily.length > visibleDailyRows.length
                ? ` Showing ${visibleDailyRows.length} active days in this window.`
                : ""}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card/95">
                  <tr className="border-b border-border/80 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 text-left font-semibold">Day</th>
                    <th className="px-2 py-2 text-right font-semibold">Sessions</th>
                    <th className="px-2 py-2 text-right font-semibold">Attempts</th>
                    <th className="px-2 py-2 text-right font-semibold">Authorized</th>
                    <th className="px-2 py-2 text-right font-semibold">Vouchers</th>
                    <th className="px-2 py-2 text-right font-semibold">TOS clicks</th>
                    <th className="px-2 py-2 text-left font-semibold">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDailyRows.map((item) => (
                    <tr key={item.day} className="border-b border-border/50">
                      <td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-foreground">
                        {new Date(item.day).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                        {item.sessions_started}
                      </td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">{item.auth_attempts}</td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">{item.auth_success}</td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                        {item.voucher_redemptions}
                      </td>
                      <td className="px-2 py-2 text-right text-xs text-muted-foreground">{item.tos_clicks}</td>
                      <td className="w-[220px] px-2 py-2">
                        <div className="h-2 rounded-full bg-muted/60">
                          <div
                            className="h-2 rounded-full bg-foreground/80"
                            style={{ width: `${Math.max((item.auth_attempts / dailyMax) * 100, 2)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleDailyRows.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  Showing {Math.min((dailyPage - 1) * dailyPageSize + 1, visibleDailyRows.length)}-
                  {Math.min(dailyPage * dailyPageSize, visibleDailyRows.length)} of {visibleDailyRows.length}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={dailyPageSize}
                    onChange={(event) => {
                      setDailyPageSize(Number(event.target.value));
                      setDailyPage(1);
                    }}
                  >
                    <option value={15}>15 / page</option>
                    <option value={30}>30 / page</option>
                    <option value={60}>60 / page</option>
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDailyPage((current) => Math.max(1, current - 1))}
                    disabled={dailyPage <= 1}
                  >
                    Previous
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    Page {dailyPage} of {dailyPageCount}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDailyPage((current) => Math.min(dailyPageCount, current + 1))}
                    disabled={dailyPage >= dailyPageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
