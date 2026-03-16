import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/(admin)/admin/layout";

const replaceMock = vi.fn();
const apiFetchMock = vi.fn();
let currentPathname = "/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: replaceMock }),
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
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  };
});

describe("Admin layout gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = "/admin";
    window.localStorage.clear();
  });

  it("redirects admin routes to setup before rendering shell when bootstrap is incomplete", async () => {
    apiFetchMock.mockResolvedValueOnce({ bootstrapped: false });

    render(
      <AdminLayout>
        <div>Dashboard content</div>
      </AdminLayout>
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/setup");
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/setup/status");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Admin Console")).not.toBeInTheDocument();
  });

  it("redirects admin routes to login silently when bootstrapped but unauthenticated", async () => {
    const { ApiError } = await import("@/lib/api");
    apiFetchMock
      .mockResolvedValueOnce({ bootstrapped: true })
      .mockRejectedValueOnce(new ApiError("Login required.", 401));

    render(
      <AdminLayout>
        <div>Dashboard content</div>
      </AdminLayout>
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/admin/login");
    });
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, "/api/setup/status");
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, "/api/admin/me");
    expect(screen.queryByText("Admin Console")).not.toBeInTheDocument();
  });

  it("renders login route without mounting admin shell or auth bootstrap", () => {
    currentPathname = "/admin/login";

    render(
      <AdminLayout>
        <div>Login form</div>
      </AdminLayout>
    );

    expect(screen.getByText("Login form")).toBeInTheDocument();
    expect(screen.queryByText("Admin Console")).not.toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
