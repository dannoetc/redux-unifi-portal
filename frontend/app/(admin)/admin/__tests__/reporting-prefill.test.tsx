import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthEventsPage from "@/app/(admin)/admin/auth-events/page";
import VouchersPage from "@/app/(admin)/admin/vouchers/page";

const replaceMock = vi.fn();
const apiFetchMock = vi.fn();
const toastErrorMock = vi.fn();
let mockQueryString = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/auth-events",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => ({
    get: (key: string) => new URLSearchParams(mockQueryString).get(key),
    toString: () => mockQueryString,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: any[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/use-tenant", () => ({
  useTenantSelection: () => ({
    tenantId: "tenant-1",
    tenants: [{ id: "tenant-1", name: "Acme" }],
  }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
  apiDownloadCsv: vi.fn(),
}));

describe("Reporting query prefill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryString = "";
  });

  it("prefills auth-event filters from URL and syncs query on change", async () => {
    mockQueryString = "method=voucher&result=fail&search=abc&site_id=site-1";
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.includes("/sites")) {
        return {
          sites: [
            { id: "site-1", display_name: "HQ" },
            { id: "site-2", display_name: "Lobby" },
          ],
        };
      }
      if (path.includes("/auth-events")) {
        return { events: [] };
      }
      throw new Error(`Unhandled apiFetch path: ${path}`);
    });

    const user = userEvent.setup();
    render(<AuthEventsPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/admin/tenants/tenant-1/auth-events?method=voucher&result=fail&search=abc&site_id=site-1"
      );
    });

    expect((screen.getByLabelText("Method") as HTMLSelectElement).value).toBe("voucher");
    expect((screen.getByLabelText("Result") as HTMLSelectElement).value).toBe("fail");
    expect((screen.getByLabelText("Site") as HTMLSelectElement).value).toBe("site-1");
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("abc");

    await user.selectOptions(screen.getByLabelText("Method"), "oidc");
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/admin/auth-events?method=oidc&result=fail&search=abc&site_id=site-1",
        { scroll: false }
      );
    });
  });

  it("prefills vouchers site selector from URL", async () => {
    mockQueryString = "site_id=site-2";
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.includes("/sites")) {
        return {
          sites: [
            { id: "site-1", display_name: "HQ" },
            { id: "site-2", display_name: "Lobby" },
          ],
        };
      }
      throw new Error(`Unhandled apiFetch path: ${path}`);
    });

    render(<VouchersPage />);

    await waitFor(() => {
      expect((screen.getByLabelText("Site") as HTMLSelectElement).value).toBe("site-2");
    });
  });
});
