import { prisma } from "../../../infra/db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { TOTP, generateSecret, verifySync } from "otplib";
import QRCode from "qrcode";
import { env } from "../../../config/env";
import { SECURITY } from "../../../config/constants";
import { logSecurityEvent } from "../../../config/logger";
import { encrypt, decrypt } from "../../../shared/security/encryption";
import {
  isAccountLocked,
  recordFailedLogin,
  resetFailedAttempts,
  getProgressiveDelay,
} from "../../../middlewares/accountLockout";
import { log as auditLog } from "../../saas/audit/audit.service";

/**
 * Custom error class for auth operations — carries a machine-readable code.
 */
export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** In-memory set of invalidated refresh tokens (cleared on restart). */
export const invalidatedRefreshTokens = new Set<string>();

/**
 * Hardened password validation.
 * - Minimum 12 characters
 * - Uppercase, lowercase, number, and special character required
 * - Rejects common/breached password patterns
 * - Maximum length to prevent bcrypt DoS (72 bytes)
 */
function validatePassword(password: string): string | null {
  if (password.length < SECURITY.PASSWORD.MIN_LENGTH) {
    return `Password must be at least ${SECURITY.PASSWORD.MIN_LENGTH} characters`;
  }
  if (password.length > SECURITY.PASSWORD.MAX_LENGTH) {
    return `Password must not exceed ${SECURITY.PASSWORD.MAX_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return "Password must contain at least one special character (!@#$%^&*...)";
  }

  // Reject common password patterns
  const lowerPassword = password.toLowerCase();
  for (const blocked of SECURITY.PASSWORD.BLOCKED_PATTERNS) {
    if (lowerPassword.includes(blocked)) {
      return "Password is too common. Please choose a stronger password.";
    }
  }

  // Reject passwords that are just repeated characters
  if (/^(.)\1+$/.test(password)) {
    return "Password must not consist of repeated characters";
  }

  // Reject sequential patterns
  if (/^(012|123|234|345|456|567|678|789|abc|bcd|cde)/i.test(password)) {
    return "Password must not contain sequential patterns";
  }

  return null;
}

/**
 * Sign JWT with hardened options: issuer, audience, algorithm pinning.
 */
function signAccessToken(payload: {
  sub: string;
  role: string;
  orgId: string;
  email: string;
}): string {
  return jwt.sign(
    {
      ...payload,
      type: "access",
    },
    env.JWT_SECRET,
    {
      expiresIn: SECURITY.JWT.ACCESS_TOKEN_EXPIRY,
      algorithm: SECURITY.JWT.ALGORITHM,
      issuer: SECURITY.JWT.ISSUER,
      audience: SECURITY.JWT.AUDIENCE,
    }
  );
}

/**
 * Sign a refresh token (longer-lived, used to get new access tokens).
 */
function signRefreshToken(payload: {
  sub: string;
  orgId: string;
}): string {
  return jwt.sign(
    {
      ...payload,
      type: "refresh",
    },
    env.JWT_SECRET,
    {
      expiresIn: SECURITY.JWT.REFRESH_TOKEN_EXPIRY,
      algorithm: SECURITY.JWT.ALGORITHM,
      issuer: SECURITY.JWT.ISSUER,
      audience: SECURITY.JWT.AUDIENCE,
    }
  );
}

export class AuthService {
  static async login(email: string, password: string, ip?: string, userAgent?: string) {
    // ─── Account lockout check ─────────────────────────────
    const lockStatus = isAccountLocked(email);
    if (lockStatus.locked) {
      logSecurityEvent({
        event: "AUTH_LOGIN_LOCKED",
        ip,
        userAgent,
        severity: "HIGH",
        details: { email, remainingMs: lockStatus.remainingMs },
      });
      throw new Error("Account is temporarily locked due to too many failed attempts. Try again later.");
    }

    // ─── Progressive delay ─────────────────────────────────
    const delay = getProgressiveDelay(email);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            industry: true,
            size: true,
          },
        },
      },
    });

    // Never leak which check failed — constant-time-like response
    if (!user) {
      // Hash a dummy password to prevent timing attacks
      await bcrypt.hash("dummy_password_timing_safe", SECURITY.PASSWORD.BCRYPT_ROUNDS);
      recordFailedLogin(email, ip, userAgent);
      logSecurityEvent({
        event: "AUTH_LOGIN_FAILED",
        ip,
        userAgent,
        severity: "MEDIUM",
        details: { email, reason: "user_not_found" },
      });
      throw new AuthError("INVALID_CREDENTIALS", "Invalid credentials");
    }

    if (!user.isActive) {
      recordFailedLogin(email, ip, userAgent);
      logSecurityEvent({
        event: "AUTH_LOGIN_FAILED",
        userId: user.id,
        ip,
        userAgent,
        severity: "MEDIUM",
        details: { reason: "account_deactivated" },
      });
      // ── Audit: failed login (deactivated) ───────────────
      auditLog({
        orgId: user.orgId,
        actorId: user.id,
        action: "auth.login.failed",
        entityType: "user",
        entityId: user.id,
        metadata: { reason: "account_disabled" },
        ipAddress: ip,
        userAgent,
      }).catch(() => {});
      throw new AuthError("ACCOUNT_DISABLED", "Account is disabled");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      recordFailedLogin(email, ip, userAgent);
      logSecurityEvent({
        event: "AUTH_LOGIN_FAILED",
        userId: user.id,
        ip,
        userAgent,
        severity: "MEDIUM",
        details: { reason: "invalid_password" },
      });
      // ── Audit: failed login (wrong password) ────────────
      auditLog({
        orgId: user.orgId,
        actorId: user.id,
        action: "auth.login.failed",
        entityType: "user",
        entityId: user.id,
        metadata: { reason: "invalid_password" },
        ipAddress: ip,
        userAgent,
      }).catch(() => {});
      throw new AuthError("INVALID_CREDENTIALS", "Invalid credentials");
    }

    // ─── 2FA check ─────────────────────────────────────────
    if (user.twoFactorEnabled) {
      return {
        twoFactorRequired: true,
        userId: user.id,
      };
    }

    // ─── Success — reset lockout counter ───────────────────
    resetFailedAttempts(email);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      orgId: user.orgId,
      email: user.email,
    });

    const refreshToken = signRefreshToken({
      sub: user.id,
      orgId: user.orgId,
    });

    logSecurityEvent({
      event: "AUTH_LOGIN_SUCCESS",
      userId: user.id,
      orgId: user.orgId,
      ip,
      userAgent,
      severity: "LOW",
    });

    // ── Audit: successful login ─────────────────────────────
    auditLog({
      orgId: user.orgId,
      actorId: user.id,
      action: "auth.login.success",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email },
      ipAddress: ip,
      userAgent,
    }).catch(() => {});

    return {
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        role: user.role,
        orgId: user.orgId,
        onboardingComplete: user.onboardingComplete,
      },
      organization: user.organization,
    };
  }

  static async refreshAccessToken(refreshTokenStr: string, ip?: string) {
    // Check if token was invalidated by logout
    if (invalidatedRefreshTokens.has(refreshTokenStr)) {
      throw new AuthError("TOKEN_REVOKED", "Token has been revoked");
    }

    try {
      const payload = jwt.verify(refreshTokenStr, env.JWT_SECRET, {
        algorithms: [SECURITY.JWT.ALGORITHM],
        issuer: SECURITY.JWT.ISSUER,
        audience: SECURITY.JWT.AUDIENCE,
      }) as any;

      if (payload.type !== "refresh") {
        throw new Error("Invalid token type");
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          orgId: true,
          isActive: true,
          passwordChangedAt: true,
        },
      });

      if (!user || !user.isActive) {
        throw new Error("User not found or deactivated");
      }

      // Check if password was changed after refresh token was issued
      if (user.passwordChangedAt && payload.iat) {
        const changedAt = Math.floor(user.passwordChangedAt.getTime() / 1000);
        if (payload.iat < changedAt) {
          throw new Error("Token invalidated by password change");
        }
      }

      const newAccessToken = signAccessToken({
        sub: user.id,
        role: user.role,
        orgId: user.orgId,
        email: user.email,
      });

      // Rotate refresh token
      const newRefreshToken = signRefreshToken({
        sub: user.id,
        orgId: user.orgId,
      });

      logSecurityEvent({
        event: "AUTH_LOGIN_SUCCESS",
        userId: user.id,
        ip,
        severity: "LOW",
        details: { type: "token_refresh" },
      });

      return {
        token: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (err) {
      logSecurityEvent({
        event: "AUTH_TOKEN_INVALID",
        ip,
        severity: "MEDIUM",
        details: { type: "refresh_token_invalid" },
      });
      throw new Error("Invalid or expired refresh token");
    }
  }

  static async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        orgId: true,
        name: true,
        avatarUrl: true,
        timezone: true,
        locale: true,
        onboardingComplete: true,
        twoFactorEnabled: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            domain: true,
            industry: true,
            size: true,
          },
        },
      },
    });

    if (!user) return null;
    return user;
  }

  static async generate2FA(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new Error("User not found");
    if (!user.isActive) throw new Error("Access revoked");

    // Generate TOTP secret using modern otplib
    const secret = generateSecret();

    // Encrypt the secret before storing (at-rest encryption)
    const encryptedSecret = encrypt(secret);

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptedSecret },
    });

    const totp = new TOTP();
    const otpauthUrl = totp.toURI({ issuer: "CodeSila", label: user.email, secret });
    const qrCode = await QRCode.toDataURL(otpauthUrl);

    logSecurityEvent({
      event: "AUTH_2FA_ENABLED",
      userId,
      severity: "LOW",
      details: { action: "generated" },
    });

    return {
      qrCode,
      // Do NOT return the raw secret — the QR code is sufficient
    };
  }

  static async verify2FA(userId: string, token: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.twoFactorSecret) throw new Error("2FA not initialized");
    if (!user.isActive) throw new Error("Access revoked");

    // Decrypt the stored secret
    const decryptedSecret = decrypt(user.twoFactorSecret);

    const result = verifySync({ secret: decryptedSecret, token });
    const verified = result.valid;

    if (!verified) {
      logSecurityEvent({
        event: "AUTH_2FA_FAILED",
        userId,
        severity: "MEDIUM",
        details: { action: "verify" },
      });
      throw new Error("Invalid code");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    logSecurityEvent({
      event: "AUTH_2FA_ENABLED",
      userId,
      severity: "LOW",
      details: { action: "enabled" },
    });

    return true;
  }

  static async login2FA(userId: string, token: string, ip?: string, userAgent?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.twoFactorSecret) throw new Error("2FA not configured");
    if (!user.isActive) throw new Error("Access revoked");

    // Decrypt the stored secret
    const decryptedSecret = decrypt(user.twoFactorSecret);

    const result = verifySync({ secret: decryptedSecret, token });
    const verified = result.valid;

    if (!verified) {
      recordFailedLogin(user.email, ip, userAgent);
      logSecurityEvent({
        event: "AUTH_2FA_FAILED",
        userId,
        ip,
        userAgent,
        severity: "MEDIUM",
        details: { action: "login_2fa" },
      });
      throw new Error("Invalid 2FA code");
    }

    // Reset lockout on successful 2FA
    resetFailedAttempts(user.email);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      orgId: user.orgId,
      email: user.email,
    });

    const refreshToken = signRefreshToken({
      sub: user.id,
      orgId: user.orgId,
    });

    logSecurityEvent({
      event: "AUTH_2FA_SUCCESS",
      userId,
      orgId: user.orgId,
      ip,
      userAgent,
      severity: "LOW",
    });

    return {
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        role: user.role,
        orgId: user.orgId,
      },
    };
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip?: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isActive) {
      throw new Error("Access revoked");
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      logSecurityEvent({
        event: "AUTH_PASSWORD_CHANGE_FAILED",
        userId,
        ip,
        severity: "MEDIUM",
        details: { reason: "invalid_current_password" },
      });
      throw new Error("Invalid credentials");
    }

    if (currentPassword === newPassword) {
      throw new Error("New password must be different from current password");
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const passwordHash = await bcrypt.hash(newPassword, SECURITY.PASSWORD.BCRYPT_ROUNDS);

    // Update password AND set passwordChangedAt to invalidate existing tokens
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });

    logSecurityEvent({
      event: "AUTH_PASSWORD_CHANGED",
      userId,
      ip,
      severity: "LOW",
    });

    return true;
  }
}
