import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReportsPage from "@/app/(admin)/admin/reports/page";

const replaceMock = vi.fn();
const routerMock = { replace: replaceMock };
const apiFetchMock = vi.fn();
const apiDownloadCsvMock = vi.fn();
const STORAGE_KEY = "redux_unifi_report_filters:tenant-1";
const PRESETS_STORAGE_KEY = "redux_unifi_report_presets:tenant-1";
const storageState: Record<string, string> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/use-tenant", () => ({
  useTenantSelection: () => ({
    tenantId: "tenant-1",
    tenants: [{ id: "tenant-1", name: "Acme" }],
  }),
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError,
    apiFetch: (...args: any[]) => apiFetchMock(...args),
    apiDownloadCsv: (...args: any[]) => apiDownloadCsvMock(...args),
  };
});

describe("Reports page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(storageState).forEach((key) => delete storageState[key]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storageState ? storageState[key] : null),
        setItem: (key: string, value: string) => {
          storageState[key] = String(value);
        },
        removeItem: (key: string) => {
          delete storageState[key];
        },
      },
    });
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.includes("/sites")) {
        return {
          sites: [
            { id: "site-1", display_name: "HQ" },
            { id: "site-2", display_name: "Lobby" },
          ],
        };
      }
      if (path.includes("/reports/method-daily")) {
        return { rows: [] };
      }
      if (path.includes("/reports/site-comparison")) {
        return { rows: [] };
      }
      throw new Error(`Unhandled path: ${path}`);
    });
    apiDownloadCsvMock.mockResolvedValue("export.csv");
  });

  it("restores saved filters and uses them for API and CSV exports", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ days: 7, siteId: "site-2", method: "voucher" })
    );

    const user = userEvent.setup();
    render(<ReportsPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/admin/tenants/tenant-1/reports/method-daily?days=7&site_id=site-2&method=voucher"
      );
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/admin/tenants/tenant-1/reports/site-comparison?days=7&site_id=site-2&method=voucher"
    );

    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe("7");
    expect((screen.getByLabelText("Site") as HTMLSelectElement).value).toBe("site-2");
    expect((screen.getByLabelText("Method") as HTMLSelectElement).value).toBe("voucher");

    const exportButtons = screen.getAllByRole("button", { name: "Export CSV" });
    await user.click(exportButtons[0]);
    await user.click(exportButtons[1]);

    expect(apiDownloadCsvMock).toHaveBeenCalledWith(
      "/api/admin/tenants/tenant-1/reports/method-daily/export.csv?days=7&site_id=site-2&method=voucher",
      "method-daily-report.csv"
    );
    expect(apiDownloadCsvMock).toHaveBeenCalledWith(
      "/api/admin/tenants/tenant-1/reports/site-comparison/export.csv?days=7&site_id=site-2&method=voucher",
      "site-comparison-report.csv"
    );
  });

  it("saves and reapplies a named preset", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/admin/tenants/tenant-1/reports/method-daily?days=30");
    });

    await user.selectOptions(screen.getByLabelText("Period"), "7");
    await user.selectOptions(screen.getByLabelText("Site"), "site-1");
    await user.selectOptions(screen.getByLabelText("Method"), "oidc");
    await user.type(screen.getByLabelText("Preset name"), "OIDC focus");
    await user.click(screen.getByRole("button", { name: "Save preset" }));

    let storedPresets: Array<{
      id: string;
      name: string;
      filters: { days: number; siteId: string; method: string };
    }> = [];
    await waitFor(() => {
      storedPresets = JSON.parse(storageState[PRESETS_STORAGE_KEY] ?? "[]");
      expect(storedPresets.some((preset) => preset.name === "OIDC focus")).toBe(true);
    });
    const saved = storedPresets.find((preset) => preset.name === "OIDC focus");
    expect(saved?.filters).toEqual({ days: 7, siteId: "site-1", method: "oidc" });

    await user.selectOptions(screen.getByLabelText("Method"), "voucher");
    expect((screen.getByLabelText("Method") as HTMLSelectElement).value).toBe("voucher");

    const option = screen.getByRole("option", { name: "OIDC focus" });
    await user.selectOptions(screen.getByLabelText("Saved preset"), option);
    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe("7");
    expect((screen.getByLabelText("Site") as HTMLSelectElement).value).toBe("site-1");
    expect((screen.getByLabelText("Method") as HTMLSelectElement).value).toBe("oidc");
  });
});
