"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiError, apiDownloadFile, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { OpenVpnClient } from "@/components/OpenVpn/OpenVpnGenerateDialog";

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  openvpn_clients?: OpenVpnClient[] | null;
};

type OpenVpnClientListProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: TenantSummary | null;
  onRefresh?: () => Promise<void> | void;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function OpenVpnClientList({
  open,
  onOpenChange,
  tenant,
  onRefresh,
}: OpenVpnClientListProps) {
  const [clients, setClients] = useState<OpenVpnClient[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientToRevoke, setClientToRevoke] = useState<OpenVpnClient | null>(null);

  useEffect(() => {
    setClients(tenant?.openvpn_clients ?? []);
  }, [tenant]);

  const sortedClients = useMemo(
    () =>
      [...clients].sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      }),
    [clients]
  );

  const handleDownload = async (client: OpenVpnClient) => {
    if (!tenant) {
      return;
    }
    try {
      await apiDownloadFile(
        `/api/admin/tenants/${tenant.id}/openvpn/clients/${client.id}`,
        `${client.client_name}.ovpn`
      );
      toast.success("OpenVPN profile downloaded.");
    } catch (error: any) {
      if (error instanceof ApiError && error.code === "OPENVPN_PROFILE_NOT_GENERATED") {
        toast.error("No generated profile exists — click Generate to create one.");
        return;
      }
      try {
        await apiDownloadFile(
          `/api/admin/tenants/${tenant.id}/openvpn/profile`,
          `${tenant.slug}-openvpn.ovpn`
        );
        toast.success("OpenVPN profile downloaded.");
      } catch (fallbackError: any) {
        toast.error(fallbackError?.message ?? "Unable to download OpenVPN profile.");
      }
    }
  };

  const confirmRevoke = (client: OpenVpnClient) => {
    setClientToRevoke(client);
    setConfirmOpen(true);
  };

  const handleRevoke = async () => {
    if (!tenant || !clientToRevoke) {
      return;
    }
    setRevokingId(clientToRevoke.id);
    try {
      await apiFetch(`/api/admin/tenants/${tenant.id}/openvpn/clients/${clientToRevoke.id}`, {
        method: "DELETE",
      });
      setClients((prev) => prev.filter((client) => client.id !== clientToRevoke.id));
      toast.success("OpenVPN profile revoked.");
      setConfirmOpen(false);
      setClientToRevoke(null);
      await onRefresh?.();
    } catch (error: any) {
      if (error instanceof ApiError && error.code === "OPENVPN_NOT_CONFIGURED") {
        toast.error("OpenVPN is not configured for this tenant. See operations docs.");
      } else {
        toast.error(error?.message ?? "Unable to revoke OpenVPN profile.");
      }
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage gateway profiles</DialogTitle>
            <DialogDescription>
              Generated OpenVPN gateway profiles for {tenant?.name ?? "this tenant"}. Profiles are
              split-tunnel only (redirect-gateway is removed).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {sortedClients.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                No generated profiles yet. Use &quot;Generate gateway profile&quot; to create one.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-md border border-border/70">
                {sortedClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-foreground">{client.client_name}</div>
                      <div className="text-xs text-muted-foreground">
                        Created {formatDateTime(client.created_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => handleDownload(client)}>
                        Download
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => confirmRevoke(client)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Profiles are intended for gateway devices only. The API serves profiles; it does not join the
              VPN automatically.
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke gateway profile</DialogTitle>
            <DialogDescription>
              This will revoke {clientToRevoke?.client_name ?? "this profile"}. Gateways using it will lose
              access until a new profile is installed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={Boolean(revokingId)}>
              {revokingId ? "Revoking..." : "Confirm revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
