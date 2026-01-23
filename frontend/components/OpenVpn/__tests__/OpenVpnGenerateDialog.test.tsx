import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OpenVpnGenerateDialog } from "@/components/OpenVpn/OpenVpnGenerateDialog";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiFetch: vi.fn(),
    apiDownloadFile: vi.fn(),
  };
});

const apiFetchMock = vi.mocked(apiFetch);

describe("OpenVpnGenerateDialog", () => {
  it("validates required client name", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <OpenVpnGenerateDialog
        open
        onOpenChange={() => {}}
        tenant={{ id: "tenant-1", name: "Acme", slug: "acme" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Generate profile" }));

    expect(await screen.findByText("Client name is required.")).toBeInTheDocument();
  });

  it("submits and shows generated metadata", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    apiFetchMock.mockResolvedValueOnce({
      client: {
        id: "client-1",
        client_name: "gateway-01",
        created_at: "2024-01-02T10:00:00Z",
      },
    });

    render(
      <OpenVpnGenerateDialog
        open
        onOpenChange={() => {}}
        tenant={{ id: "tenant-1", name: "Acme", slug: "acme" }}
      />
    );

    await user.type(screen.getByLabelText("Client name"), " gateway-01 ");
    await user.click(screen.getByRole("button", { name: "Generate profile" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/admin/tenants/tenant-1/openvpn/generate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ client_name: "gateway-01" }),
        })
      );
    });

    expect(await screen.findByText("Profile generated")).toBeInTheDocument();
    expect(screen.getByText("gateway-01")).toBeInTheDocument();
  });

  it("shows gateway credentials after generation when provided", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    apiFetchMock.mockResolvedValueOnce({
      client: {
        id: "client-2",
        client_name: "gateway-02",
        created_at: "2024-01-03T10:00:00Z",
      },
      auth_username: "unifi-user",
      auth_password: "unifi-pass",
    });

    render(
      <OpenVpnGenerateDialog
        open
        onOpenChange={() => {}}
        tenant={{ id: "tenant-1", name: "Acme", slug: "acme" }}
      />
    );

    await user.type(screen.getByLabelText("Client name"), "gateway-02");
    await user.click(screen.getByRole("button", { name: "Generate profile" }));

    expect(await screen.findByText("Gateway credentials")).toBeInTheDocument();
    expect(screen.getByText("unifi-user")).toBeInTheDocument();
    expect(screen.getByText("unifi-pass")).toBeInTheDocument();
  });
});
