"use client";

import { Sidebar } from "@/components/admin/shell/sidebar";
import { TopBar } from "@/components/admin/shell/topbar";
import { useSidebarState } from "@/components/admin/shell/useSidebarState";
import { cn } from "@/lib/utils";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { collapsed, setCollapsed } = useSidebarState();

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
