"use client";

import { ElementType } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useTenantSelection } from "@/lib/use-tenant";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/sites", label: "Sites" },
  { href: "/admin/admin-users", label: "Admins" },
  { href: "/admin/oidc-providers", label: "OIDC" },
  { href: "/admin/vouchers", label: "Vouchers" },
  { href: "/admin/auth-events", label: "Auth Events" },
];

type SidebarNavProps = {
  collapsed?: boolean;
  icons?: Record<string, ElementType>;
};

export function SidebarNav({ collapsed = false, icons = {} }: SidebarNavProps) {
  const pathname = usePathname();
  const { adminUser } = useTenantSelection();
  const isSuperadmin = adminUser?.is_superadmin ?? false;

  return (
    <ul className={cn("mt-3 space-y-1.5 text-sm", collapsed ? "mt-2" : "mt-3")}>
      {NAV_ITEMS.filter((item) => (item.href === "/admin/admin-users" ? isSuperadmin : true)).map(
        (item) => {
        const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = icons[item.label] ?? icons.default;
        return (
          <li key={item.href}>
            <a
              className={cn(
                "relative flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                collapsed ? "justify-center px-2" : "justify-start",
                isActive
                  ? "bg-muted/30 font-medium text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
              {!collapsed ? (
                <span className="truncate">{item.label}</span>
              ) : (
                <span className="sr-only">{item.label}</span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
