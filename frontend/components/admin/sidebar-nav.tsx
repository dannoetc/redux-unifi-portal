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
              className={`flex items-center justify-between rounded-md border-l-4 px-2 py-1.5 text-sm ${
                isActive
                  ? "border-primary bg-muted/40 font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:border-primary/60 hover:text-foreground"
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
