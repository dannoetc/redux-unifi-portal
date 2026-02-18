"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { AdminShellControls } from "@/components/admin/admin-shell-controls";

const TITLE_MAP = [
  { path: "/admin/tenants", label: "Tenants" },
  { path: "/admin/sites", label: "Sites" },
  { path: "/admin/admin-users", label: "Admins" },
  { path: "/admin/oidc-providers", label: "OIDC" },
  { path: "/admin/vouchers", label: "Vouchers" },
  { path: "/admin/reports", label: "Reports" },
  { path: "/admin/auth-events", label: "Auth Events" },
  { path: "/admin/certificates", label: "Certificates" },
  { path: "/admin", label: "Dashboard" },
];

export function TopBar() {
  const pathname = usePathname();
  const title = useMemo(() => {
    if (!pathname) {
      return "Admin";
    }
    const match = TITLE_MAP.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
    return match?.label ?? "Admin";
  }, [pathname]);

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/90 backdrop-blur">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Admin</span>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        <AdminShellControls />
      </div>
    </header>
  );
}
