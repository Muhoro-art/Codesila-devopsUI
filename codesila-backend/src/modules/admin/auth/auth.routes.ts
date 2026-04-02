import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AuthService, AuthError, invalidatedRefreshTokens } from "./auth.service";
import { registerCompany } from "./register.service";
import { authMiddleware } from "../../../middlewares/auth";
import { authRateLimiter, authSlowDown, sensitiveOpRateLimiter } from "../../../middlewares/rateLimit";
import { sanitizeEmail, sanitizeString } from "../../../shared/utils/sanitize";
import { logSecurityEvent } from "../../../config/logger";
import { SECURITY } from "../../../config/constants";

const router = Router();

/** Set refresh token as an HttpOnly cookie on the response. */
function setRefreshCookie(res: Response, token: string) {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: SECURITY.COOKIE.SECURE,
    sameSite: SECURITY.COOKIE.SAME_SITE,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/** Clear the refresh token cookie. */
function clearRefreshCookie(res: Response) {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: SECURITY.COOKIE.SECURE,
    sameSite: SECURITY.COOKIE.SAME_SITE,
    path: "/",
  });
}

// ─── Company Registration ───────────────────────────────────
const registerSchema = z.object({
  companyName: z.string().min(2, "Company name must be at least 2 characters").max(100),
  industry: z.string().max(100).optional(),
  companySize: z.enum(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"]),
  domain: z.string().max(255).optional(),
  email: z.string().email("Invalid email address").max(254),
  password: z.string().min(12).max(128),
  fullName: z.string().min(1, "Full name is required").max(100),
  jobTitle: z.string().max(100).optional(),
});

/**
 * POST /auth/register
 * Registers a new company + founding admin user.
 * Returns JWT so the user is logged in immediately.
 */
router.post("/register", authRateLimiter, authSlowDown, async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join("; ");
      logSecurityEvent({
        event: "INPUT_VALIDATION_FAILED",
        ip: req.ip,
        resource: "/auth/register",
        severity: "LOW",
        details: { errors: parsed.error.errors.map(e => e.message) },
      });
      return res.status(400).json({ error: message });
    }

    // Sanitize inputs
    const data = {
      ...parsed.data,
      email: sanitizeEmail(parsed.data.email),
      companyName: sanitizeString(parsed.data.companyName),
      fullName: sanitizeString(parsed.data.fullName),
      industry: parsed.data.industry ? sanitizeString(parsed.data.industry) : undefined,
      domain: parsed.data.domain ? sanitizeString(parsed.data.domain) : undefined,
      jobTitle: parsed.data.jobTitle ? sanitizeString(parsed.data.jobTitle) : undefined,
    };

    const result = await registerCompany(data);
    return res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Registration failed";
    return res.status(400).json({ error: msg });
  }
});

// ─── Login Validation ───────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email("Invalid email format").max(254),
  password: z.string().min(1, "Password is required").max(128),
});

/** Shared login handler for /login and /signin */
async function handleLogin(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details,
        fields: details,
      });
    }

    const email = sanitizeEmail(parsed.data.email);
    const result = await AuthService.login(
      email,
      parsed.data.password,
      req.ip,
      req.headers["user-agent"]
    );

    // Set refresh token as HttpOnly cookie
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }

    return res.json({
      success: true,
      data: {
        accessToken: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
        organization: result.organization,
      },
      // Legacy flat fields for backward compatibility
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
      organization: result.organization,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ success: false, error: err.message, code: err.code });
    }
    const msg =
      err instanceof Error ? err.message : "Invalid credentials";

    return res.status(401).json({ success: false, error: msg, code: "INVALID_CREDENTIALS" });
  }
}

/**
 * POST /auth/login
 * POST /auth/signin
 * Authenticates an existing user and returns JWT
 */
router.post("/login", authRateLimiter, authSlowDown, handleLogin);
router.post("/signin", authRateLimiter, authSlowDown, handleLogin);

/**
 * POST /auth/refresh
 * Exchange a valid refresh token for a new access+refresh token pair.
 * Implements token rotation (old refresh token becomes invalid).
 */
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    // Read refresh token from cookie first, fall back to body
    const refreshToken = req.cookies?.refreshToken ?? req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "No refresh token provided", code: "NO_REFRESH_TOKEN" });
    }

    const result = await AuthService.refreshAccessToken(refreshToken, req.ip);

    // Set rotated refresh token cookie
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }

    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token refresh failed";
    const code = err instanceof AuthError ? err.code : "INVALID_REFRESH_TOKEN";
    return res.status(401).json({ error: msg, code });
  }
});

/**
 * POST /auth/logout
 * Clears the refresh token cookie and invalidates the token.
 */
router.post("/logout", async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    invalidatedRefreshTokens.add(refreshToken);
  }
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

/**
 * GET /auth/me
 * Returns identity of the current user (JWT required)
 */
router.get("/me", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const userId = res.locals.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await AuthService.me(userId);
    return res.json(user);
  } catch {
    return res.status(500).json({
      error: "Failed to load user",
    });
  }
});

/**
 * POST /auth/change-password
 * Changes the current user's password (JWT required)
 * Invalidates all existing tokens after password change.
 */
router.post(
  "/change-password",
  authMiddleware,
  sensitiveOpRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: "currentPassword and newPassword are required",
        });
      }

      await AuthService.changePassword(userId, currentPassword, newPassword, req.ip);
      return res.json({
        ok: true,
        message: "Password changed. All existing sessions have been invalidated.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to change password";
      return res.status(400).json({ error: msg });
    }
  }
);

/**
 * POST /auth/2fa/generate
 * Generates 2FA secret and QR code (JWT required)
 */
router.post(
  "/2fa/generate",
  authMiddleware,
  sensitiveOpRateLimiter,
  async (_req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await AuthService.generate2FA(userId);
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate 2FA";
      return res.status(400).json({ error: msg });
    }
  }
);

/**
 * POST /auth/2fa/verify
 * Verifies 2FA token and enables 2FA (JWT required)
 */
router.post(
  "/2fa/verify",
  authMiddleware,
  sensitiveOpRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { token } = req.body ?? {};
      if (!token || typeof token !== "string" || !/^\d{6}$/.test(token)) {
        return res.status(400).json({ error: "A valid 6-digit token is required" });
      }

      await AuthService.verify2FA(userId, token);
      return res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to verify 2FA";
      return res.status(400).json({ error: msg });
    }
  }
);

/**
 * POST /auth/2fa/login
 * Exchanges 2FA token for JWT after initial login response
 */
router.post("/2fa/login", authRateLimiter, authSlowDown, async (req: Request, res: Response) => {
  try {
    const { userId, token } = req.body ?? {};
    if (!userId || !token) {
      return res.status(400).json({ error: "userId and token are required" });
    }

    // Validate token format (must be 6-digit OTP)
    if (typeof token !== "string" || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ error: "Invalid 2FA code format" });
    }

    const result = await AuthService.login2FA(
      userId,
      token,
      req.ip,
      req.headers["user-agent"]
    );
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "2FA login failed";
    return res.status(400).json({ error: msg });
  }
});

export default router;
