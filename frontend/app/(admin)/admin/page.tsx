"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";

type AdminMe = {
  admin_user: {
    id: string;
    email: string;
    is_superadmin: boolean;
    memberships: { tenant_id: string; role: string }[];
  };
};

export default function AdminHome() {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<AdminMe>("/api/admin/me")
      .then((data) => {
        if (active) {
          setMe(data);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load admin profile.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your MSP tenancy footprint and portal usage.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-muted/30 p-5">
          <div className="text-sm font-semibold text-foreground">Admin session</div>
          <div className="mt-1 text-xs text-muted-foreground">Signed in details</div>
          <div className="mt-4 space-y-1 text-sm">
            {loading ? (
              <div className="text-muted-foreground">Loading admin profile...</div>
            ) : me ? (
              <>
                <div>{me.admin_user.email}</div>
                <div className="text-muted-foreground">
                  {me.admin_user.is_superadmin ? "Superadmin" : "Tenant admin"}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">Not authenticated.</div>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-muted/30 p-5">
          <div className="text-sm font-semibold text-foreground">Tenants</div>
          <div className="mt-1 text-xs text-muted-foreground">Membership count</div>
          <div className="mt-4 text-2xl font-semibold">
            {me?.admin_user.memberships.length ?? 0}
          </div>
        </div>
        <div className="rounded-lg bg-muted/30 p-5">
          <div className="text-sm font-semibold text-foreground">Next actions</div>
          <div className="mt-1 text-xs text-muted-foreground">Common admin tasks</div>
          <div className="mt-4 space-y-2 text-sm">
            <div>Configure OIDC providers for tenant SSO.</div>
            <div>Create voucher batches for event access.</div>
            <div>Review auth event exports.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
