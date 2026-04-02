import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import Verify2FAPage from "../Verify2FAPage";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../api/auth", () => ({
  login2FA: vi.fn(),
}));

const { login2FA } = await import("../../api/auth");

describe("Verify2FAPage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("redirects to login when missing pending user", () => {
    render(<Verify2FAPage />);

    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("exchanges 2FA token for JWT and routes by role", async () => {
    sessionStorage.setItem("pending2faUserId", "user-1");

    (login2FA as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: "jwt-token",
      user: {
        id: "user-1",
        email: "test@example.com",
        role: "ADMIN",
        orgId: "org-1",
      },
    });

    render(<Verify2FAPage />);

    await userEvent.type(screen.getByPlaceholderText("123456"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify/i }));

    expect(localStorage.getItem("token")).toBe("jwt-token");
    expect(sessionStorage.getItem("pending2faUserId")).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith("/admin");
  });
});
