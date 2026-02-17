import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(admin)/admin/page";

const replaceMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
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
  };
});

vi.mock("@/components/ui/PopoverMenu", () => ({
  PopoverMenu: ({ trigger, children }: any) => (
    <div>
      {trigger}
      <div>{children}</div>
    </div>
  ),
  PopoverMenuItem: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

describe("Admin dashboard drill-down links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockImplementation(async (path: string) => {
      const query = path.includes("?") ? path.split("?")[1] : "";
      const params = new URLSearchParams(query);
      return {
        period_days: 30,
        site_id: params.get("site_id"),
        window_start: "2026-02-01T00:00:00Z",
        window_end: "2026-02-17T00:00:00Z",
        generated_at: "2026-02-17T00:00:00Z",
        overview: {
          sessions_started: 12,
          sessions_authorized: 9,
          sessions_failed: 2,
          auth_attempts: 10,
          auth_success: 8,
          auth_fail: 2,
          success_rate: 80,
          voucher_redemptions: 3,
          tos_clicks: 2,
        },
        methods: [
          { method: "voucher", attempts: 4, success: 3, fail: 1, success_rate: 75 },
          { method: "email_otp", attempts: 3, success: 2, fail: 1, success_rate: 66.67 },
          { method: "oidc", attempts: 2, success: 2, fail: 0, success_rate: 100 },
          { method: "tos_only", attempts: 1, success: 1, fail: 0, success_rate: 100 },
        ],
        daily: [
          {
            day: "2026-02-15",
            sessions_started: 3,
            sessions_authorized: 2,
            sessions_failed: 1,
            auth_attempts: 3,
            auth_success: 2,
            auth_fail: 1,
            voucher_redemptions: 1,
            tos_clicks: 1,
            otp_success: 0,
            oidc_success: 1,
          },
        ],
        sites: [
          {
            site_id: "site-1",
            site_name: "HQ",
            sessions_started: 9,
            auth_attempts: 7,
            auth_success: 6,
            voucher_redemptions: 3,
            tos_clicks: 1,
            success_rate: 85.71,
          },
        ],
        site_options: [
          { id: "site-1", display_name: "HQ" },
          { id: "site-2", display_name: "Lobby" },
        ],
      };
    });
  });

  it("adds site and method filters to drill-down links", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await screen.findByText("Guest Access Operations");

    const authEventsTopLink = screen.getByRole("link", { name: "View auth events" });
    expect(authEventsTopLink).toHaveAttribute("href", "/admin/auth-events");

    await user.click(screen.getByRole("button", { name: "HQ" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "View auth events" })).toHaveAttribute(
        "href",
        "/admin/auth-events?site_id=site-1"
      );
    });

    expect(screen.getByRole("link", { name: "Manage vouchers" })).toHaveAttribute(
      "href",
      "/admin/vouchers?site_id=site-1"
    );
    expect(screen.getByRole("link", { name: "View successful auth" })).toHaveAttribute(
      "href",
      "/admin/auth-events?result=success&site_id=site-1"
    );
    expect(screen.getByRole("link", { name: "Review voucher auth" })).toHaveAttribute(
      "href",
      "/admin/auth-events?method=voucher&result=success&site_id=site-1"
    );
    expect(screen.getByRole("link", { name: "Inspect TOS events" })).toHaveAttribute(
      "href",
      "/admin/auth-events?method=tos_only&result=success&site_id=site-1"
    );
  });
});
