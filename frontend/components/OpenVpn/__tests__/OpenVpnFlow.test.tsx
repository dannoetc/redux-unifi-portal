import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OpenVpnClientList } from "@/components/OpenVpn/OpenVpnClientList";
import { OpenVpnGenerateDialog, OpenVpnClient } from "@/components/OpenVpn/OpenVpnGenerateDialog";
import { apiDownloadFile, apiFetch } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiFetch: vi.fn(),
    apiDownloadFile: vi.fn(),
  };
});

const apiFetchMock = vi.mocked(apiFetch);
const apiDownloadMock = vi.mocked(apiDownloadFile);

const TestHarness = () => {
  const [tenant, setTenant] = useState({
    id: "tenant-1",
    name: "Acme",
    slug: "acme",
    openvpn_clients: [] as OpenVpnClient[],
  });
  const [showList, setShowList] = useState(false);

  const handleGenerated = (client: OpenVpnClient) => {
    setTenant((prev) => ({
      ...prev,
      openvpn_clients: [...prev.openvpn_clients, client],
    }));
    setShowList(true);
  };

  return (
    <>
      <OpenVpnGenerateDialog
        open
        onOpenChange={() => {}}
        tenant={{ id: tenant.id, name: tenant.name, slug: tenant.slug }}
        onGenerated={handleGenerated}
      />
      {showList ? (
        <OpenVpnClientList
          open
          onOpenChange={() => {}}
          tenant={tenant}
          onRefresh={() => {}}
        />
      ) : null}
    </>
  );
};

describe("OpenVPN flow", () => {
  it("generates, downloads, and revokes a profile", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    apiFetchMock.mockResolvedValueOnce({
      client: {
        id: "client-1",
        client_name: "gateway-01",
        created_at: "2024-01-02T10:00:00Z",
      },
    });
    apiFetchMock.mockResolvedValueOnce({ ok: true });

    render(<TestHarness />);

    await user.type(screen.getByLabelText("Client name"), "gateway-01");
    await user.click(screen.getByRole("button", { name: "Generate profile" }));

    expect(await screen.findAllByText("gateway-01")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => {
      expect(apiDownloadMock).toHaveBeenCalledWith(
        "/api/admin/tenants/tenant-1/openvpn/profile",
        "gateway-01.ovpn"
      );
    });

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/admin/tenants/tenant-1/openvpn/clients/client-1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    expect(await screen.findByText(/No generated profiles yet/i)).toBeInTheDocument();
  });
});
