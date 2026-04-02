// src/middlewares/accountLockout.ts
// Account-level brute-force protection.
// Tracks failed login attempts per account (not just per IP).
// Locks the account after too many failures.

import { SECURITY } from "../config/constants";
import { logSecurityEvent } from "../config/logger";

const { MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MINS } = SECURITY.LOCKOUT;

interface LoginAttempt {
  failedAttempts: number;
  lastFailedAt: number;
  lockedUntil: number | null;
}

// In-memory store (replace with Redis for multi-instance production)
const loginAttempts = new Map<string, LoginAttempt>();

// Cleanup expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts.entries()) {
    if (entry.lockedUntil && entry.lockedUntil < now) {
      loginAttempts.delete(key);
    } else if (now - entry.lastFailedAt > LOCKOUT_DURATION_MINS * 60 * 1000 * 2) {
      loginAttempts.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Check if an account is locked. Returns the lock info if locked.
 */
export function isAccountLocked(
  identifier: string
): { locked: true; remainingMs: number } | { locked: false } {
  const attempt = loginAttempts.get(identifier.toLowerCase());
  if (!attempt?.lockedUntil) return { locked: false };

  const now = Date.now();
  if (attempt.lockedUntil > now) {
    return { locked: true, remainingMs: attempt.lockedUntil - now };
  }

  // Lock expired — reset
  loginAttempts.delete(identifier.toLowerCase());
  return { locked: false };
}

/**
 * Record a failed login attempt. Locks the account after the threshold.
 */
export function recordFailedLogin(
  identifier: string,
  ip?: string,
  userAgent?: string
): void {
  const key = identifier.toLowerCase();
  const now = Date.now();

  const current = loginAttempts.get(key) ?? {
    failedAttempts: 0,
    lastFailedAt: 0,
    lockedUntil: null,
  };

  current.failedAttempts += 1;
  current.lastFailedAt = now;

  if (current.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    current.lockedUntil = now + LOCKOUT_DURATION_MINS * 60 * 1000;

    logSecurityEvent({
      event: "AUTH_ACCOUNT_LOCKED",
      ip,
      userAgent,
      severity: "HIGH",
      details: {
        identifier: key,
        failedAttempts: current.failedAttempts,
        lockedUntilIso: new Date(current.lockedUntil).toISOString(),
      },
    });
  }

  loginAttempts.set(key, current);
}

/**
 * Reset failed attempts on successful login.
 */
export function resetFailedAttempts(identifier: string): void {
  loginAttempts.delete(identifier.toLowerCase());
}

/**
 * Clear all lockout entries (for testing).
 */
export function resetAllLockouts(): void {
  loginAttempts.clear();
}

/**
 * Get the progressive delay (in ms) based on failed attempts.
 * Used to slow down brute-force even before lockout.
 */
export function getProgressiveDelay(identifier: string): number {
  const attempt = loginAttempts.get(identifier.toLowerCase());
  if (!attempt || attempt.failedAttempts === 0) return 0;

  // Exponential backoff: 0, 500ms, 1s, 2s, 4s...
  return Math.min(
    SECURITY.RATE_LIMIT.SLOW_DOWN_DELAY_MS * Math.pow(2, attempt.failedAttempts - 1),
    10_000 // Max 10 seconds
  );
}
