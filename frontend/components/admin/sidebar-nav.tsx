"use client";

import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/sites", label: "Sites" },
  { href: "/admin/admin-users", label: "Admins" },
  { href: "/admin/oidc-providers", label: "OIDC" },
  { href: "/admin/vouchers", label: "Vouchers" },
  { href: "/admin/auth-events", label: "Auth Events" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <ul className="mt-3 space-y-2 text-sm">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <a
              className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-muted/30 font-medium text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
