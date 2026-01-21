"use client";

import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Users,
  Network,
  Shield,
  KeyRound,
  Ticket,
  Activity,
  Building2,
} from "lucide-react";

import { SidebarNav } from "@/components/admin/sidebar-nav";
import { SidebarTenantSwitcher } from "@/components/admin/sidebar-tenant-switcher";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  return (
    <aside
      className={cn(
        "border-b border-border/60 bg-background lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r",
        "flex flex-col overflow-y-auto"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-4">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          R
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">ReduxTC WiFi</div>
            <div className="text-xs text-muted-foreground">Admin Console</div>
          </div>
        ) : null}
      </div>
      <div className={cn("px-4", collapsed ? "pb-2" : "pb-4")}>
        <SidebarTenantSwitcher collapsed={collapsed} onExpand={() => onCollapsedChange(false)} />
      </div>
      <div className={cn("px-2", collapsed ? "pb-2" : "pb-4")}>
        {!collapsed ? (
          <div className="px-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            Navigation
          </div>
        ) : null}
        <SidebarNav
          collapsed={collapsed}
          icons={{
            Dashboard: LayoutDashboard,
            Tenants: Building2,
            Sites: Network,
            Admins: Shield,
            OIDC: KeyRound,
            Vouchers: Ticket,
            "Auth Events": Activity,
            default: Users,
          }}
        />
      </div>
      <div className="mt-auto border-t border-border/60 px-2 py-3">
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors",
            "hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          )}
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : null}
          {!collapsed ? (
            <>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Collapse
            </>
          ) : null}
        </button>
      </div>
    </aside>
  );
}
