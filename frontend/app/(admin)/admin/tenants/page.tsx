"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";

import { ApiError, apiDownloadFile, apiFetch } from "@/lib/api";
import { DataTable } from "@/components/data-table";
import { OpenVpnClientList } from "@/components/OpenVpn/OpenVpnClientList";
import { OpenVpnGenerateDialog, OpenVpnClient } from "@/components/OpenVpn/OpenVpnGenerateDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import StatusPill from "@/components/ui/StatusPill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const optionalPort = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "number" && Number.isNaN(value)) {
      return undefined;
    }
    return value;
  },
  z.number().int().positive().optional()
);

const schema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  status: z.string().optional(),
  unifi_base_url: z.string().optional().or(z.literal("")),
  unifi_port: optionalPort,
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  unifi_api_key: z.string().optional().or(z.literal("")),
  is_roaming: z.boolean().optional(),
  openvpn_enabled: z.boolean().optional(),
  openvpn_profile_ref: z.string().optional().or(z.literal("")),
  openvpn_profile_template: z.string().optional().or(z.literal("")),
  openvpn_auth_ref: z.string().optional().or(z.literal("")),
  openvpn_auth_blob: z.string().optional().or(z.literal("")),
  openvpn_ca_ref: z.string().optional().or(z.literal("")),
  openvpn_ca_bundle: z.string().optional().or(z.literal("")),
  openvpn_remote_host: z.string().optional().or(z.literal("")),
  openvpn_remote_port: optionalPort,
});

const controllerSchema = z.object({
  unifi_base_url: z.string().optional().or(z.literal("")),
  unifi_port: optionalPort,
  unifi_api_key_ref: z.string().optional().or(z.literal("")),
  unifi_api_key: z.string().optional().or(z.literal("")),
  is_roaming: z.boolean().optional(),
  openvpn_enabled: z.boolean().optional(),
  openvpn_profile_ref: z.string().optional().or(z.literal("")),
  openvpn_profile_template: z.string().optional().or(z.literal("")),
  openvpn_auth_ref: z.string().optional().or(z.literal("")),
  openvpn_auth_blob: z.string().optional().or(z.literal("")),
  openvpn_ca_ref: z.string().optional().or(z.literal("")),
  openvpn_ca_bundle: z.string().optional().or(z.literal("")),
  openvpn_remote_host: z.string().optional().or(z.literal("")),
  openvpn_remote_port: optionalPort,
});

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  unifi_base_url?: string | null;
  unifi_api_key_ref?: string | null;
  unifi_api_key_stored?: boolean | null;
  is_roaming?: boolean;
  openvpn_enabled?: boolean;
  openvpn_profile_ref?: string | null;
  openvpn_profile_stored?: boolean;
  openvpn_auth_ref?: string | null;
  openvpn_auth_stored?: boolean;
  openvpn_ca_ref?: string | null;
  openvpn_ca_stored?: boolean;
  openvpn_remote_host?: string | null;
  openvpn_remote_port?: number | null;
  openvpn_generated_client_name?: string | null;
  openvpn_generated_created_at?: string | null;
  openvpn_clients?: OpenVpnClient[] | null;
};

type TenantList = { tenants: Tenant[] };

type CreateTenant = z.infer<typeof schema>;

const formatStatus = (status?: string) => {
  const normalized = (status ?? "ACTIVE").toLowerCase();
  if (normalized === "active") {
    return "active";
  }
  if (normalized === "suspended" || normalized === "inactive") {
    return "inactive";
  }
  return "unknown";
};

const UNIFI_INTEGRATION_PATH = "/proxy/network/integration";
const DEFAULT_UNIFI_PORT = 443;

const parseUnifiHostAndPort = (value?: string | null) => {
  if (!value) {
    return { host: "", port: DEFAULT_UNIFI_PORT };
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    const parsedPort = url.port ? Number(url.port) : DEFAULT_UNIFI_PORT;
    return {
      host: url.hostname,
      port: Number.isNaN(parsedPort) ? DEFAULT_UNIFI_PORT : parsedPort,
    };
  } catch {
    return { host: value, port: DEFAULT_UNIFI_PORT };
  }
};

const applyUnifiPort = (value: string | undefined | null, port: number | undefined) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const { host, port: parsedPort } = parseUnifiHostAndPort(trimmed);
  const resolvedPort = port ?? parsedPort;
  if (!resolvedPort || resolvedPort === DEFAULT_UNIFI_PORT) {
    return host;
  }
  return `${host}:${resolvedPort}`;
};

const normalizeUnifiBaseUrl = (value: string | undefined | null) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (withProtocol.includes(UNIFI_INTEGRATION_PATH)) {
    return withProtocol;
  }
  return `${withProtocol.replace(/\/+$/, "")}${UNIFI_INTEGRATION_PATH}`;
};

const displayUnifiHost = (value?: string | null) => {
  return parseUnifiHostAndPort(value).host;
};

const displayUnifiPort = (value?: string | null) => {
  return parseUnifiHostAndPort(value).port;
};

const openvpnDocsUrl = "/docs/operations-security.md";

const getLatestOpenvpnClient = (tenant: Tenant) => {
  const clients = tenant.openvpn_clients ?? [];
  if (!clients.length) {
    return null;
  }
  return clients.reduce<OpenVpnClient | null>((latest, client) => {
    if (!latest) {
      return client;
    }
    const latestTime = new Date(latest.created_at).getTime();
    const clientTime = new Date(client.created_at).getTime();
    if (Number.isNaN(latestTime) || Number.isNaN(clientTime)) {
      return latest;
    }
    return clientTime > latestTime ? client : latest;
  }, null);
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [controllerOpen, setControllerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
  const [tenantToConfigure, setTenantToConfigure] = useState<Tenant | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupInitialized, setSetupInitialized] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [tenantToGenerate, setTenantToGenerate] = useState<Tenant | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [tenantToManage, setTenantToManage] = useState<Tenant | null>(null);
  const [showAdvancedOpenvpn, setShowAdvancedOpenvpn] = useState(false);
  const [generatedGatewayAuth, setGeneratedGatewayAuth] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [generateFromControllerOpen, setGenerateFromControllerOpen] = useState(false);
  const [controllerValidationError, setControllerValidationError] = useState<string>("");

  const form = useForm<CreateTenant>({
    resolver: zodResolver(schema),
    defaultValues: { status: "ACTIVE", unifi_port: DEFAULT_UNIFI_PORT, unifi_api_key: "" },
  });
  const controllerForm = useForm<z.infer<typeof controllerSchema>>({
    resolver: zodResolver(controllerSchema),
    defaultValues: {
      is_roaming: false,
      openvpn_enabled: false,
      openvpn_profile_ref: "",
      openvpn_profile_template: "",
      openvpn_auth_ref: "",
      openvpn_auth_blob: "",
      openvpn_ca_ref: "",
      openvpn_ca_bundle: "",
      openvpn_remote_host: "",
      unifi_port: DEFAULT_UNIFI_PORT,
      unifi_api_key: "",
    },
  });

  useEffect(() => {
    let active = true;
    apiFetch<TenantList>("/api/admin/tenants")
      .then((data) => {
        if (active) {
          setTenants(data.tenants);
        }
      })
      .catch((error) => {
        toast.error(error?.message ?? "Unable to load tenants.");
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

  useEffect(() => {
    if (!setupInitialized && !loading) {
      setSetupOpen(tenants.length === 0);
      setSetupInitialized(true);
    }
  }, [loading, setupInitialized, tenants.length]);

  const hasGeneratedOrStoredProfile = (tenant: Tenant | null): boolean => {
    if (!tenant) {
      return false;
    }
    const latestClient = getLatestOpenvpnClient(tenant);
    const hasGeneratedClient = Boolean(latestClient) || Boolean(tenant.openvpn_generated_client_name);
    const hasStoredProfile = Boolean(tenant.openvpn_profile_stored);
    return hasGeneratedClient || hasStoredProfile;
  };

  const loadFileIntoField =
    (field: "openvpn_profile_template" | "openvpn_ca_bundle" | "openvpn_auth_blob") =>
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      try {
        const content = await file.text();
        controllerForm.setValue(field, content, { shouldDirty: true });
        toast.success("Loaded OpenVPN content from file.");
      } catch (error: any) {
        toast.error(error?.message ?? "Unable to read the selected file.");
      } finally {
        event.target.value = "";
      }
    };

  const downloadOpenvpnProfile = async (tenant: Tenant) => {
    const openvpnEnabled = Boolean(tenant.openvpn_enabled);
    const latestClient = getLatestOpenvpnClient(tenant);
    const hasGeneratedProfile =
      Boolean(latestClient) || Boolean(tenant.openvpn_generated_client_name);
    const openvpnDisabledMessage = "OpenVPN is not configured for this tenant. See operations docs.";

    if (!openvpnEnabled) {
      toast.error(openvpnDisabledMessage);
      return;
    }
    if (!hasGeneratedProfile) {
      toast.error("No generated profile exists — click Generate to create one.");
      return;
    }
    try {
      const filename = latestClient ? `${latestClient.client_name}.ovpn` : `${tenant.slug}-openvpn.ovpn`;
      await apiDownloadFile(`/api/admin/tenants/${tenant.id}/openvpn/profile`, filename);
      toast.success("OpenVPN profile downloaded.");
    } catch (error: any) {
      if (error instanceof ApiError) {
        if (error.code === "OPENVPN_NOT_CONFIGURED") {
          toast.error(openvpnDisabledMessage);
          return;
        }
        if (error.code === "OPENVPN_PROFILE_NOT_GENERATED") {
          toast.error("No generated profile exists — click Generate to create one.");
          return;
        }
        if (error.code === "OPENVPN_GENERATION_FAILED") {
          toast.error("OpenVPN generation failed. Check the tenant configuration.");
          return;
        }
        if (error.status === 404 && !latestClient) {
          toast.error("No generated profile exists — click Generate to create one.");
          return;
        }
      }
      toast.error(error?.message ?? "Unable to download OpenVPN profile.");
    }
  };

  const RowActions = ({ tenant }: { tenant: Tenant }) => {
    const openvpnEnabled = Boolean(tenant.openvpn_enabled);
    const openvpnDisabledMessage = "OpenVPN is not configured for this tenant. See operations docs.";

    return (
      <PopoverMenu
        trigger={
          <button
            type="button"
            aria-label="Open row actions"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      >
        <PopoverMenuItem
          onClick={() => {
            setTenantToConfigure(tenant);
            setGeneratedGatewayAuth(null);
            const hasAdvancedOpenvpn =
              Boolean(tenant.openvpn_profile_stored) ||
              Boolean(tenant.openvpn_ca_stored) ||
              Boolean(tenant.openvpn_auth_stored) ||
              Boolean(tenant.openvpn_profile_ref) ||
              Boolean(tenant.openvpn_ca_ref) ||
              Boolean(tenant.openvpn_auth_ref);
            setShowAdvancedOpenvpn(hasAdvancedOpenvpn);
            const { host, port } = parseUnifiHostAndPort(tenant.unifi_base_url);
            controllerForm.reset({
              unifi_base_url: host,
              unifi_port: port,
              unifi_api_key_ref: tenant.unifi_api_key_ref ?? "",
              unifi_api_key: "",
              is_roaming: tenant.is_roaming ?? false,
              openvpn_enabled: tenant.openvpn_enabled ?? false,
              openvpn_profile_ref: tenant.openvpn_profile_ref ?? "",
              openvpn_profile_template: "",
              openvpn_auth_ref: tenant.openvpn_auth_ref ?? "",
              openvpn_auth_blob: "",
              openvpn_ca_ref: tenant.openvpn_ca_ref ?? "",
              openvpn_ca_bundle: "",
              openvpn_remote_host: tenant.openvpn_remote_host ?? "",
              openvpn_remote_port: tenant.openvpn_remote_port ?? undefined,
            });
            setControllerOpen(true);
          }}
        >
          Configure UniFi
        </PopoverMenuItem>
        <PopoverMenuSeparator />
        <PopoverMenuItem
          onClick={() => {
            setTenantToGenerate(tenant);
            setGenerateOpen(true);
          }}
        >
          Generate gateway profile…
        </PopoverMenuItem>
        <PopoverMenuItem
          disabled={!openvpnEnabled}
          title={openvpnEnabled ? undefined : openvpnDisabledMessage}
          onClick={() => {
            if (!openvpnEnabled) {
              toast.error(openvpnDisabledMessage);
              return;
            }
            setTenantToManage(tenant);
            setManageOpen(true);
          }}
        >
          Manage gateway profiles
        </PopoverMenuItem>
        <PopoverMenuItem
          disabled={!openvpnEnabled}
          title={openvpnEnabled ? undefined : openvpnDisabledMessage}
          onClick={() => downloadOpenvpnProfile(tenant)}
        >
          Download gateway profile
        </PopoverMenuItem>
        {!openvpnEnabled ? (
          <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground" role="presentation">
            OpenVPN is disabled for this tenant.{" "}
            <Link className="text-primary underline-offset-4 hover:underline" href={openvpnDocsUrl}>
              See operations docs
            </Link>
            .
          </div>
        ) : null}
        <PopoverMenuSeparator />
        <PopoverMenuItem
          className="text-destructive"
          onClick={() => {
            setTenantToDelete(tenant);
            setDeleteOpen(true);
          }}
        >
          Remove tenant
        </PopoverMenuItem>
      </PopoverMenu>
    );
  };

  const columns = useMemo<ColumnDef<Tenant>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="font-medium text-foreground">{row.original.name}</div>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        meta: { hiddenOnMobile: true },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.slug}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { hiddenOnMobile: true },
        cell: ({ row }) => (
          <StatusPill status={formatStatus(row.original.status)} />
        ),
      },
      {
        id: "details",
        header: () => <span className="md:hidden">Details</span>,
        meta: { showOnMobileOnly: true, headerClassName: "text-xs" },
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground md:hidden">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Slug</span>
              <span>{row.original.slug}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Status</span>
              <StatusPill status={formatStatus(row.original.status)} />
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <RowActions tenant={row.original} />
          </div>
        ),
      },
    ],
    []
  );

  const onSubmit = async (values: CreateTenant) => {
    try {
      const { unifi_port, ...rest } = values;
      const unifiHost = applyUnifiPort(values.unifi_base_url, unifi_port);
      const payload = {
        ...rest,
        status: values.status ?? "ACTIVE",
        unifi_base_url: normalizeUnifiBaseUrl(unifiHost),
        unifi_api_key_ref: values.unifi_api_key_ref || undefined,
        unifi_api_key: values.unifi_api_key?.trim() ? values.unifi_api_key : undefined,
      };
      const data = await apiFetch<{ tenant: Tenant }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setTenants((prev) => [data.tenant, ...prev]);
      toast.success("Tenant created.");
      setDialogOpen(false);
      form.reset();
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to create tenant.");
    }
  };

  const deleteTenant = async () => {
    if (!tenantToDelete) {
      return;
    }
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/tenants/${tenantToDelete.id}`, { method: "DELETE" });
      setTenants((prev) => prev.filter((tenant) => tenant.id !== tenantToDelete.id));
      toast.success("Tenant removed.");
      setDeleteOpen(false);
      setTenantToDelete(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to remove tenant.");
    } finally {
      setDeleting(false);
    }
  };

  const saveController = async (values: z.infer<typeof controllerSchema>) => {
    if (!tenantToConfigure) {
      return;
    }

    // Validate that a generated/stored profile exists if OpenVPN is being enabled
    if (values.openvpn_enabled) {
      const latestClient = getLatestOpenvpnClient(tenantToConfigure);
      const hasGeneratedClient = Boolean(latestClient) || Boolean(tenantToConfigure.openvpn_generated_client_name);
      const hasStoredProfile = Boolean(tenantToConfigure.openvpn_profile_stored);
      const hasProfileTemplate = Boolean(values.openvpn_profile_template?.trim());
      const hasProfileRef = Boolean(values.openvpn_profile_ref?.trim());

      if (!hasGeneratedClient && !hasStoredProfile && !hasProfileTemplate && !hasProfileRef) {
        setControllerValidationError(
          "A generated gateway profile is required to enable OpenVPN. Click Generate gateway profile… to create one."
        );
        return;
      }
    }

    setControllerValidationError("");

    try {
      const openvpnPort =
        values.openvpn_remote_port && Number.isNaN(values.openvpn_remote_port)
          ? undefined
          : values.openvpn_remote_port;
      const unifiHost = applyUnifiPort(values.unifi_base_url, values.unifi_port);
      const payload = {
        unifi_base_url: normalizeUnifiBaseUrl(unifiHost),
        unifi_api_key_ref: values.unifi_api_key_ref || undefined,
        unifi_api_key: values.unifi_api_key?.trim() ? values.unifi_api_key : undefined,
        is_roaming: values.is_roaming,
        openvpn_enabled: values.openvpn_enabled,
        openvpn_profile_ref: values.openvpn_profile_ref || undefined,
        openvpn_profile_template: values.openvpn_profile_template?.trim()
          ? values.openvpn_profile_template
          : undefined,
        openvpn_auth_ref: values.openvpn_auth_ref || undefined,
        openvpn_auth_blob: values.openvpn_auth_blob?.trim() ? values.openvpn_auth_blob : undefined,
        openvpn_ca_ref: values.openvpn_ca_ref || undefined,
        openvpn_ca_bundle: values.openvpn_ca_bundle?.trim() ? values.openvpn_ca_bundle : undefined,
        openvpn_remote_host: values.openvpn_remote_host || undefined,
        openvpn_remote_port: openvpnPort,
      };
      const data = await apiFetch<{ tenant: Tenant }>(`/api/admin/tenants/${tenantToConfigure.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setTenants((prev) =>
        prev.map((tenant) => (tenant.id === data.tenant.id ? data.tenant : tenant))
      );
      toast.success("Tenant networking updated.");
      setControllerOpen(false);
      setTenantToConfigure(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update UniFi controller.");
    }
  };

  const refreshTenants = async (): Promise<void> => {
    try {
      const data = await apiFetch<TenantList>("/api/admin/tenants");
      setTenants(data.tenants);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to refresh tenants.");
    }
  };

  const handleGenerateClick = async () => {
    if (!tenantToConfigure) {
      return;
    }

    // Validate required OpenVPN settings for generation
    const currentValues = controllerForm.getValues();
    const hasRemoteHost = Boolean(currentValues.openvpn_remote_host?.trim());
    const hasRemotePort = Boolean(currentValues.openvpn_remote_port);

    if (!hasRemoteHost) {
      toast.error("OpenVPN server host is required to generate client configs.");
      return;
    }

    if (!hasRemotePort) {
      toast.error("OpenVPN server port is required to generate client configs.");
      return;
    }

    // Save the form first to persist OpenVPN remote host/port and other settings needed for generation
    const currentValuesForSave = controllerForm.getValues();
    try {
      const openvpnPort =
        currentValuesForSave.openvpn_remote_port && Number.isNaN(currentValuesForSave.openvpn_remote_port)
          ? undefined
          : currentValuesForSave.openvpn_remote_port;
      const unifiHost = applyUnifiPort(currentValuesForSave.unifi_base_url, currentValuesForSave.unifi_port);
      const payload = {
        unifi_base_url: normalizeUnifiBaseUrl(unifiHost),
        is_roaming: currentValuesForSave.is_roaming,
        openvpn_enabled: currentValuesForSave.openvpn_enabled,
        openvpn_profile_ref: currentValuesForSave.openvpn_profile_ref || undefined,
        openvpn_profile_template: currentValuesForSave.openvpn_profile_template?.trim()
          ? currentValuesForSave.openvpn_profile_template
          : undefined,
        openvpn_auth_ref: currentValuesForSave.openvpn_auth_ref || undefined,
        openvpn_auth_blob: currentValuesForSave.openvpn_auth_blob?.trim()
          ? currentValuesForSave.openvpn_auth_blob
          : undefined,
        openvpn_ca_ref: currentValuesForSave.openvpn_ca_ref || undefined,
        openvpn_ca_bundle: currentValuesForSave.openvpn_ca_bundle?.trim()
          ? currentValuesForSave.openvpn_ca_bundle
          : undefined,
        openvpn_remote_host: currentValuesForSave.openvpn_remote_host,
        openvpn_remote_port: openvpnPort,
        unifi_api_key_ref: currentValuesForSave.unifi_api_key_ref || undefined,
        unifi_api_key: currentValuesForSave.unifi_api_key?.trim()
          ? currentValuesForSave.unifi_api_key
          : undefined,
      };

      await apiFetch<{ tenant: Tenant }>(`/api/admin/tenants/${tenantToConfigure.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      // Update local state with the saved tenant
      const refreshed = await apiFetch<{ tenant: Tenant }>(`/api/admin/tenants/${tenantToConfigure.id}`);
      setTenantToConfigure(refreshed.tenant);
      setTenants((prev) =>
        prev.map((t) => (t.id === refreshed.tenant.id ? refreshed.tenant : t))
      );

      // Now open the generate dialog
      setGenerateFromControllerOpen(true);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to save settings before generation.");
    }
  };

  const testController = async () => {
    if (!tenantToConfigure) {
      return;
    }
    try {
      const data = await apiFetch<{ sites: Array<{ id: string }> }>(
        `/api/admin/tenants/${tenantToConfigure.id}/unifi/sites`
      );
      const count = data.sites?.length ?? 0;
      toast.success(`UniFi connection verified (${count} site${count === 1 ? "" : "s"} found).`);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to reach UniFi controller.");
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-104px)] w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage customer tenants and status.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="primary" className="shadow-sm">
              New tenant
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create tenant</DialogTitle>
              <DialogDescription>Provision a new MSP tenant.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" autoFocus {...form.register("name")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" {...form.register("slug")} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">Toggle tenant access.</div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={form.watch("status") !== "SUSPENDED"}
                    onChange={() =>
                      form.setValue(
                        "status",
                        form.watch("status") === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"
                      )
                    }
                  />
                  <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                  <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_base_url">UniFi controller IP</Label>
                <Input
                  id="unifi_base_url"
                  placeholder="71.162.143.124"
                  {...form.register("unifi_base_url")}
                />
                <p className="text-xs text-muted-foreground">
                  We append {UNIFI_INTEGRATION_PATH} automatically.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_port">UniFi controller port</Label>
                <Input
                  id="unifi_port"
                  type="number"
                  min={1}
                  max={65535}
                  {...form.register("unifi_port", { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">Defaults to {DEFAULT_UNIFI_PORT}.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_api_key">UniFi API key</Label>
                <Input id="unifi_api_key" type="password" {...form.register("unifi_api_key")} />
                <p className="text-xs text-muted-foreground">Stored encrypted in the database.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unifi_api_key_ref">UniFi API key reference (optional)</Label>
                <Input id="unifi_api_key_ref" type="password" {...form.register("unifi_api_key_ref")} />
                <p className="text-xs text-muted-foreground">Legacy env var name (overridden by stored key).</p>
              </div>
              <DialogFooter>
                <Button type="submit" variant="primary">
                  Create tenant
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <details
        className="group rounded-lg bg-muted/30 p-4"
        open={setupOpen}
        onToggle={(event) => setSetupOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white">
          Setup checklist
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Create a tenant and capture the tenant slug.</li>
          <li>2. Add one or more sites with UniFi credentials and default access policy.</li>
          <li>
            3. In the UniFi console, set the external portal host/IP to{" "}
            <span className="font-medium text-foreground">wifi.reduxtc.com</span> (hostnames only). The
            portal resolves the correct site using the UniFi Network API.
          </li>
        </ul>
      </details>
      <section className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`tenant-skeleton-${index}`}
                className="grid animate-pulse grid-cols-[2fr_1fr_1fr_80px] items-center gap-4"
              >
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-4 rounded bg-muted/60" />
                <div className="h-8 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border/60 bg-background/80 p-6">
            <div className="text-sm font-semibold">No tenants yet.</div>
            <div className="text-sm text-muted-foreground">
              Create your first tenant to start provisioning sites.
            </div>
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Create tenant
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-visible rounded-lg border border-border/60 bg-background">
            <DataTable columns={columns} data={tenants} />
          </div>
        )}
      </section>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove tenant</DialogTitle>
            <DialogDescription>
              This will permanently remove {tenantToDelete?.name ?? "this tenant"} and all associated data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteTenant} disabled={deleting}>
              {deleting ? "Removing..." : "Confirm remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OpenVpnGenerateDialog
        open={generateOpen}
        onOpenChange={(isOpen) => {
          setGenerateOpen(isOpen);
          if (!isOpen) {
            setTenantToGenerate(null);
          }
        }}
        tenant={tenantToGenerate ? { id: tenantToGenerate.id, name: tenantToGenerate.name, slug: tenantToGenerate.slug } : null}
        onGenerated={(client) => {
          if (!tenantToGenerate) {
            return;
          }
          setTenants((prev) =>
            prev.map((tenant) =>
              tenant.id === tenantToGenerate.id
                ? {
                    ...tenant,
                    openvpn_generated_client_name: client.client_name,
                    openvpn_generated_created_at: client.created_at,
                    openvpn_clients: [...(tenant.openvpn_clients ?? []), client],
                  }
                : tenant
            )
          );
        }}
        onRefresh={refreshTenants}
      />
      <OpenVpnClientList
        open={manageOpen}
        onOpenChange={(isOpen) => {
          setManageOpen(isOpen);
          if (!isOpen) {
            setTenantToManage(null);
          }
        }}
        tenant={
          tenantToManage
            ? {
                id: tenantToManage.id,
                name: tenantToManage.name,
                slug: tenantToManage.slug,
                openvpn_clients: tenantToManage.openvpn_clients ?? [],
              }
            : null
        }
        onRefresh={refreshTenants}
      />
      <Dialog open={controllerOpen} onOpenChange={setControllerOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tenant networking</DialogTitle>
            <DialogDescription>
              Configure the tenant-level UniFi controller and roaming OpenVPN profile.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={controllerForm.handleSubmit(saveController)}>
            <Tabs defaultValue="unifi">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="unifi">UniFi connection</TabsTrigger>
                <TabsTrigger value="openvpn">OpenVPN settings</TabsTrigger>
              </TabsList>
              <TabsContent value="unifi" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="controller_base_url">UniFi controller IP</Label>
                  <Input
                    id="controller_base_url"
                    placeholder="71.162.143.124"
                    {...controllerForm.register("unifi_base_url")}
                  />
                  <p className="text-xs text-muted-foreground">
                    We append {UNIFI_INTEGRATION_PATH} automatically.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="controller_port">UniFi controller port</Label>
                  <Input
                    id="controller_port"
                    type="number"
                    min={1}
                    max={65535}
                    {...controllerForm.register("unifi_port", { valueAsNumber: true })}
                  />
                  <p className="text-xs text-muted-foreground">Defaults to {DEFAULT_UNIFI_PORT}.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="controller_api_key">UniFi API key</Label>
                  <Input
                    id="controller_api_key"
                    type="password"
                    {...controllerForm.register("unifi_api_key")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tenantToConfigure?.unifi_api_key_stored
                      ? "Encrypted key is stored. Leave blank to keep the current value."
                      : "Stored encrypted in the database."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="controller_api_key_ref">API key reference (optional)</Label>
                  <Input
                    id="controller_api_key_ref"
                    type="password"
                    {...controllerForm.register("unifi_api_key_ref")}
                  />
                  <p className="text-xs text-muted-foreground">Legacy env var name (overridden by stored key).</p>
                </div>
              </TabsContent>
              <TabsContent value="openvpn" className="space-y-4">
                <div className="space-y-3 rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Roaming tenant</div>
                      <div className="text-xs text-muted-foreground">
                        Enables OpenVPN-assisted UniFi API connectivity.
                      </div>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={controllerForm.watch("is_roaming") ?? false}
                        onChange={() =>
                          controllerForm.setValue(
                            "is_roaming",
                            !(controllerForm.watch("is_roaming") ?? false)
                          )
                        }
                      />
                      <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                    </label>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">OpenVPN profile enabled</div>
                      <div className="text-xs text-muted-foreground">
                        Required to download a gateway-ready .ovpn file.
                      </div>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={controllerForm.watch("openvpn_enabled") ?? false}
                        onChange={() =>
                          controllerForm.setValue(
                            "openvpn_enabled",
                            !(controllerForm.watch("openvpn_enabled") ?? false)
                          )
                        }
                      />
                      <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                    </label>
                  </div>

                  {controllerValidationError && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {controllerValidationError}
                    </div>
                  )}

                  {hasGeneratedOrStoredProfile(tenantToConfigure) && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      <div className="font-medium">
                        {(() => {
                          const latestClient = getLatestOpenvpnClient(tenantToConfigure!);
                          if (latestClient) {
                            const createdDate = new Date(latestClient.created_at).toLocaleString();
                            return `Generated profile: ${latestClient.client_name} — created ${createdDate}`;
                          }
                          if (tenantToConfigure!.openvpn_generated_client_name) {
                            return `Generated profile: ${tenantToConfigure!.openvpn_generated_client_name}`;
                          }
                          return "Stored profile available";
                        })()}
                      </div>
                    </div>
                  )}
                  {generatedGatewayAuth ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      <div className="font-medium">Gateway credentials</div>
                      <div className="mt-1 grid gap-1">
                        <div>
                          <span className="font-semibold">Username:</span>{" "}
                          <span className="font-mono">{generatedGatewayAuth.username}</span>
                        </div>
                        <div>
                          <span className="font-semibold">Password:</span>{" "}
                          <span className="font-mono">{generatedGatewayAuth.password}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-emerald-700/80">
                        Copy these into UniFi when uploading the gateway profile.
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      Generate a profile to receive gateway credentials for UniFi upload.
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!tenantToConfigure}
                    onClick={handleGenerateClick}
                    aria-label="Generate OpenVPN gateway profile"
                  >
                    Generate client config…
                  </Button>

                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Generate creates client-specific configs with unique credentials for each gateway using a default template. Upload a custom template in Advanced options below to override. OpenVPN profiles are served for gateway devices only and do not route general traffic.
                    The API provides profiles; it does not join the VPN automatically. Profiles are
                    split-tunnel only (redirect-gateway is removed).{" "}
                    <Link className="text-primary underline-offset-4 hover:underline" href={openvpnDocsUrl}>
                      Operations &amp; Security
                    </Link>
                    .
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="openvpn_remote_host">OpenVPN server host</Label>
                      <Input
                        id="openvpn_remote_host"
                        placeholder="vpn.reduxtc.com"
                        {...controllerForm.register("openvpn_remote_host")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openvpn_remote_port">OpenVPN server port</Label>
                      <Input
                        id="openvpn_remote_port"
                        type="number"
                        placeholder="1194"
                        {...controllerForm.register("openvpn_remote_port", { valueAsNumber: true })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">Advanced OpenVPN options</div>
                      <div className="text-xs text-muted-foreground">
                        Optional template, CA, and auth overrides.
                      </div>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={showAdvancedOpenvpn}
                        onChange={() => setShowAdvancedOpenvpn((prev) => !prev)}
                      />
                      <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
                      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                    </label>
                  </div>
                  {showAdvancedOpenvpn ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="openvpn_profile_template">OpenVPN profile template</Label>
                          {tenantToConfigure?.openvpn_profile_stored ? (
                            <span className="text-xs font-medium text-emerald-600">Stored</span>
                          ) : null}
                        </div>
                        <Input
                          id="openvpn_profile_template_file"
                          type="file"
                          accept=".ovpn,.txt"
                          onChange={loadFileIntoField("openvpn_profile_template")}
                        />
                        <Textarea
                          id="openvpn_profile_template"
                          placeholder="Paste the .ovpn template content"
                          {...controllerForm.register("openvpn_profile_template")}
                        />
                        <p className="text-xs text-muted-foreground">
                          Stored templates are encrypted at rest. Include {`{{REMOTE_HOST}}`} and{" "}
                          {`{{REMOTE_PORT}}`} tokens if you want the server to inject tenant-specific values.
                          Leave blank to keep the existing stored template.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="openvpn_ca_bundle">CA bundle content</Label>
                          {tenantToConfigure?.openvpn_ca_stored ? (
                            <span className="text-xs font-medium text-emerald-600">Stored</span>
                          ) : null}
                        </div>
                        <Input
                          id="openvpn_ca_bundle_file"
                          type="file"
                          accept=".crt,.pem,.txt"
                          onChange={loadFileIntoField("openvpn_ca_bundle")}
                        />
                        <Textarea
                          id="openvpn_ca_bundle"
                          placeholder="Optional CA bundle content"
                          {...controllerForm.register("openvpn_ca_bundle")}
                        />
                        <p className="text-xs text-muted-foreground">
                          Optional: store a CA bundle to append when the template does not already include a
                          &lt;ca&gt; block. Leave blank to keep the existing stored bundle.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="openvpn_profile_ref">OpenVPN profile template ref</Label>
                        <Input id="openvpn_profile_ref" {...controllerForm.register("openvpn_profile_ref")} />
                        <p className="text-xs text-muted-foreground">
                          Backward-compatible env var reference containing the full .ovpn template.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="openvpn_ca_ref">CA bundle ref</Label>
                        <Input id="openvpn_ca_ref" {...controllerForm.register("openvpn_ca_ref")} />
                        <p className="text-xs text-muted-foreground">
                          Optional env var reference containing a CA bundle.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
            <DialogFooter className="gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={testController}>
                Test UniFi connection
              </Button>
              <Button type="submit" variant="primary">
                Save settings
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <OpenVpnGenerateDialog
        open={generateFromControllerOpen}
        onOpenChange={(isOpen) => {
          setGenerateFromControllerOpen(isOpen);
        }}
        tenant={tenantToConfigure ? { id: tenantToConfigure.id, name: tenantToConfigure.name, slug: tenantToConfigure.slug } : null}
        onGeneratedAuth={(auth) => {
          setGeneratedGatewayAuth(auth);
        }}
        onGenerated={async (client) => {
          if (!tenantToConfigure) {
            return;
          }

          try {
            const refreshedTenant = await apiFetch<{ tenant: Tenant }>(
              `/api/admin/tenants/${tenantToConfigure.id}`
            );
            const updatedTenant = refreshedTenant.tenant;

            // Update the main tenants list
            setTenants((prev) =>
              prev.map((tenant) => (tenant.id === updatedTenant.id ? updatedTenant : tenant))
            );

            // Update tenantToConfigure for the dialog
            setTenantToConfigure(updatedTenant);

            // Update controller form with new generated profile metadata
            controllerForm.setValue("openvpn_enabled", true, { shouldDirty: true });

            // Close the generate dialog but keep controller dialog open
            setGenerateFromControllerOpen(false);

            // Clear any validation errors since we now have a generated profile
            setControllerValidationError("");

            toast.success("OpenVPN profile generated and set as the default for this tenant.");
          } catch (error: any) {
            toast.error(error?.message ?? "Unable to refresh tenant after generation.");
          }
        }}
        onRefresh={refreshTenants}
      />
    </div>
  );
}
