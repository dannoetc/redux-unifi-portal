"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

type ResolveResponse = {
  tenant_slug: string;
  site_slug: string;
  portal_session_id: string;
};

function GuestEntryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function resolve() {
      const clientMac = searchParams.get("id");
      if (!clientMac) {
        setError("Missing client MAC address. Launch from UniFi captive portal.");
        setLoading(false);
        return;
      }
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
        const data = await apiFetch<ResolveResponse>("/api/guest/resolve", {
          method: "POST",
          body: JSON.stringify({
            ap: searchParams.get("ap"),
            id: clientMac,
            ssid: searchParams.get("ssid"),
            url: searchParams.get("url"),
            t: searchParams.get("t"),
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          }),
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        if (!active) {
          return;
        }
        const target = `/guest/s/${data.tenant_slug}/${data.site_slug}?portal_session_id=${data.portal_session_id}`;
        router.replace(target);
      } catch (err: any) {
        if (active) {
          const isAbort = err?.name === "AbortError";
          setError(isAbort ? "Site resolution timed out. Please retry." : err?.message ?? "Unable to resolve site.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    resolve();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <main className="surface-grid min-h-screen px-4 py-8">
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Connecting...</CardTitle>
            <CardDescription>Resolving the correct site for this portal session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="text-sm text-muted-foreground">Contacting portal service...</div> : null}
            {error ? (
              <Alert className="border-destructive/40">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function GuestEntryPage() {
  return (
    <Suspense
      fallback={
        <main className="surface-grid min-h-screen px-4 py-8">
          <div className="mx-auto max-w-md">
            <Card>
              <CardHeader>
                <CardTitle>Connecting...</CardTitle>
                <CardDescription>Preparing portal session.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">Loading...</div>
              </CardContent>
            </Card>
          </div>
        </main>
      }
    >
      <GuestEntryContent />
    </Suspense>
  );
}
