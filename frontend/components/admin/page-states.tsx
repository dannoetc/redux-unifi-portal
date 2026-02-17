import Link from "next/link";
import { AlertTriangle, Building2, PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function TenantOnboardingState({
  title = "No tenants are configured yet.",
  description = "Create your first tenant to unlock sites, reporting, and authentication workflows.",
  createHref = "/admin/tenants?onboarding=1",
  compact = false,
}: {
  title?: string;
  description?: string;
  createHref?: string;
  compact?: boolean;
}) {
  const content = (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border/70 bg-muted/40 p-2 text-muted-foreground">
          <Building2 className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <ol className="space-y-1 pl-5 text-sm text-muted-foreground">
        <li>1. Create the tenant and capture its slug.</li>
        <li>2. Add at least one site with UniFi credentials.</li>
        <li>3. Confirm the portal URL in UniFi external hotspot settings.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary">
          <Link href={createHref}>
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Create tenant
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/admin/tenants">Open tenant list</Link>
        </Button>
      </div>
    </div>
  );

  if (compact) {
    return <div className="rounded-lg border border-border/70 bg-muted/20 p-4">{content}</div>;
  }

  return (
    <Card className="rounded-xl border border-border/80 bg-card/95 p-6 shadow-soft">
      {content}
    </Card>
  );
}

export function TenantSelectionState({
  message = "Select a tenant from the sidebar to continue.",
}: {
  message?: string;
}) {
  return (
    <Card className="rounded-xl border border-border/80 bg-card/95 p-6 shadow-soft">
      <p className="text-sm text-muted-foreground">{message}</p>
    </Card>
  );
}

export function DataErrorState({
  message,
  onRetry,
  title = "Unable to load data.",
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  const content = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );

  if (compact) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">{content}</div>;
  }

  return (
    <Card className="rounded-xl border border-destructive/30 bg-card/95 p-6 shadow-soft">
      {content}
    </Card>
  );
}
