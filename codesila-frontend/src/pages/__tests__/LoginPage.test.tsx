import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import LoginPage from "../LoginPage";

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
  login: vi.fn(),
}));

const { login } = await import("../../api/auth");

describe("LoginPage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("routes to 2FA verification when required", async () => {
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({
      twoFactorRequired: true,
      userId: "user-1",
    });

    render(<LoginPage />);

    await userEvent.type(
      screen.getByPlaceholderText("name@company.com"),
      "test@example.com"
    );
    await userEvent.type(
      screen.getByPlaceholderText("••••••••••••"),
      "password123"
    );
    await userEvent.click(screen.getByRole("button", { name: /access platform/i }));

    expect(sessionStorage.getItem("pending2faUserId")).toBe("user-1");
    expect(mockNavigate).toHaveBeenCalledWith("/verify-2fa");
  });

  it("stores token and routes by role when 2FA not required", async () => {
    (login as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: "jwt-token",
      user: {
        id: "user-1",
        email: "test@example.com",
        role: "DEVOPS",
        orgId: "org-1",
      },
    });

    render(<LoginPage />);

    await userEvent.type(
      screen.getByPlaceholderText("name@company.com"),
      "test@example.com"
    );
    await userEvent.type(
      screen.getByPlaceholderText("••••••••••••"),
      "password123"
    );
    await userEvent.click(screen.getByRole("button", { name: /access platform/i }));

    expect(localStorage.getItem("token")).toBe("jwt-token");
    expect(mockNavigate).toHaveBeenCalledWith("/devops");
  });
});
