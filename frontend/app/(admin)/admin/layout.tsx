"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Sidebar } from "@/components/admin/shell/sidebar";
import { TopBar } from "@/components/admin/shell/topbar";
import { useSidebarState } from "@/components/admin/shell/useSidebarState";
import { Card } from "@/components/ui/card";
import { TenantSelectionProvider, useTenantSelection } from "@/lib/use-tenant";
import { cn } from "@/lib/utils";

function AdminChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { collapsed, setCollapsed } = useSidebarState();
  const { status, errorMessage } = useTenantSelection();

  useEffect(() => {
    if (status === "setup-required") {
      router.replace("/setup");
      return;
    }
    if (status === "unauthenticated") {
      router.replace("/admin/login");
    }
  }, [router, status]);

  if (status === "loading" || status === "setup-required" || status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6">
          <Card className="w-full rounded-xl border bg-card p-6 shadow-soft">
            <p className="text-sm text-muted-foreground">Loading admin workspace...</p>
          </Card>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6">
          <Card className="w-full rounded-xl border bg-card p-6 shadow-soft">
            <p className="text-base font-semibold text-foreground">Unable to load admin workspace.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage ?? "Unexpected error while checking setup or session state."}
            </p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div
        className={cn(
          "grid min-h-screen grid-cols-1",
          collapsed ? "lg:grid-cols-[64px_1fr]" : "lg:grid-cols-[260px_1fr]"
        )}
      >
        <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
        <div className="min-w-0">
          <TopBar />
          <main className="min-w-0 px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <TenantSelectionProvider>
      <AdminChrome>{children}</AdminChrome>
    </TenantSelectionProvider>
  );
}
