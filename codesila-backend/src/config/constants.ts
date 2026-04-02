// src/config/constants.ts
// Security constants — centralized configuration for all security parameters.

export const SECURITY = {
  // ─── PASSWORD POLICY ────────────────────────────────────────
  PASSWORD: {
    MIN_LENGTH: 12,
    MAX_LENGTH: 128,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBER: true,
    REQUIRE_SPECIAL: true,
    BCRYPT_ROUNDS: 12,
    // Common passwords to reject (top entries; a real deployment would use a full list)
    BLOCKED_PATTERNS: [
      "password", "123456", "qwerty", "abc123", "letmein", "admin",
      "welcome", "monkey", "dragon", "master", "login", "princess",
    ],
  },

  // ─── JWT / TOKEN ────────────────────────────────────────────
  JWT: {
    ACCESS_TOKEN_EXPIRY: "15m",      // Short-lived access tokens
    REFRESH_TOKEN_EXPIRY: "7d",       // Longer-lived refresh tokens
    ALGORITHM: "HS256" as const,
    ISSUER: "codesila-api",
    AUDIENCE: "codesila-client",
    CLOCK_TOLERANCE: 30,              // seconds of clock skew tolerance
  },

  // ─── RATE LIMITING ─────────────────────────────────────────
  RATE_LIMIT: {
    AUTH_WINDOW_MS: 15 * 60 * 1000,   // 15 minutes
    AUTH_MAX_ATTEMPTS: 5,              // Per IP for auth endpoints (reduced from 10)
    API_WINDOW_MS: 60 * 1000,         // 1 minute
    API_MAX_REQUESTS: 100,            // Per IP for general API
    API_KEY_WINDOW_MS: 3600 * 1000,   // 1 hour
    SLOW_DOWN_DELAY_AFTER: 3,         // Start delaying after N requests (auth)
    SLOW_DOWN_DELAY_MS: 500,          // Initial delay in ms (doubles)
  },

  // ─── ACCOUNT LOCKOUT ───────────────────────────────────────
  LOCKOUT: {
    MAX_FAILED_ATTEMPTS: 5,           // Lock after N failed login attempts per account
    LOCKOUT_DURATION_MINS: 30,        // Lockout duration in minutes
    PROGRESSIVE_DELAY: true,          // Increase delay after each failure
  },

  // ─── SESSION / TOKEN CLEANUP ───────────────────────────────
  SESSION: {
    MAX_SESSIONS_PER_USER: 5,
    IDLE_TIMEOUT_MINS: 60,
    ABSOLUTE_TIMEOUT_HOURS: 24,
  },

  // ─── WEBSOCKET ─────────────────────────────────────────────
  WEBSOCKET: {
    HEARTBEAT_INTERVAL_MS: 30_000,
    MAX_CONNECTIONS_PER_USER: 5,
    MAX_MESSAGE_SIZE: 64 * 1024,      // 64KB max message
    CLOSE_CODES: {
      UNAUTHORIZED: 4001,
      TOO_MANY_CONNECTIONS: 4002,
      INVALID_MESSAGE: 4003,
    },
  },

  // ─── BODY SIZE LIMITS ──────────────────────────────────────
  BODY: {
    JSON_LIMIT: "256kb",              // Reduced from 1mb
    URL_ENCODED_LIMIT: "256kb",
    WEBHOOK_LIMIT: "1mb",              // Webhooks can be larger
  },

  // ─── CORS ──────────────────────────────────────────────────
  CORS: {
    MAX_AGE: 600,                     // Preflight cache: 10 minutes
    ALLOWED_METHODS: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    ALLOWED_HEADERS: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-CSRF-Token",
    ],
  },

  // ─── COOKIE ────────────────────────────────────────────────
  COOKIE: {
    HTTP_ONLY: true,
    SECURE: process.env.NODE_ENV === "production",
    SAME_SITE: "strict" as const,
    PATH: "/",
    REFRESH_TOKEN_NAME: "__csrf_refresh",
    ACCESS_TOKEN_NAME: "__Host-token",
  },

  // ─── INPUT VALIDATION ──────────────────────────────────────
  INPUT: {
    MAX_STRING_LENGTH: 10_000,
    MAX_EMAIL_LENGTH: 254,
    MAX_NAME_LENGTH: 100,
    MAX_URL_LENGTH: 2048,
    ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    MAX_FILE_SIZE: 5 * 1024 * 1024,   // 5MB
  },

  // ─── ENCRYPTION ────────────────────────────────────────────
  ENCRYPTION: {
    ALGORITHM: "aes-256-gcm" as const,
    KEY_LENGTH: 32,
    IV_LENGTH: 16,
    AUTH_TAG_LENGTH: 16,
  },

  // ─── ROLE HIERARCHY ────────────────────────────────────────
  ROLE_HIERARCHY: {
    USER: 0,
    DEVELOPER: 1,
    DEVOPS: 2,
    MANAGER: 3,
    ADMIN: 4,
    SUPER_ADMIN: 5,
  } as Record<string, number>,

  // ─── SECURITY HEADERS ──────────────────────────────────────
  HEADERS: {
    HSTS_MAX_AGE: 31536000,           // 1 year
    CSP_REPORT_ONLY: false,
  },
} as const;

export default SECURITY;
