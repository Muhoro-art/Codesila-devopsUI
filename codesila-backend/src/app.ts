import express from "express";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import cookieParser from "cookie-parser";
import { prisma } from "./infra/db";
import { AssistantService } from "./modules/assistant/assistant.service";
import { StaticLinksProvider } from "./modules/assistant/links/static-links.provider";
import { buildAssistantRouter } from "./modules/assistant/assistant.routes";
import { RagService } from "./modules/assistant/rag/rag.service";
import authRouter from "./modules/admin/auth/auth.routes";
import adminRouter from "./modules/admin/admin.routes";
import { buildChatRouter } from "./modules/chat/chat.routes";
import { authMiddleware } from "./middlewares/auth";
import { errorHandler } from "./middlewares/error";
import { apiRateLimiter } from "./middlewares/rateLimit";
import { authRateLimitStore, apiRateLimitStore } from "./middlewares/rateLimit";
import { apiKeyAuth } from "./middlewares/apiKeyAuth";
import { trackUsage } from "./middlewares/trackUsage";
import { requestId, inputProtection, extraSecurityHeaders, requestTiming } from "./middlewares/security";
import { resetAllLockouts } from "./middlewares/accountLockout";
import { env } from "./config/env";
import { SECURITY } from "./config/constants";
import logger from "./config/logger";
import devflowRouter from "./routes/devflow.routes";
import projectsRouter from "./routes/projects.routes";
import integrationsRouter from "./routes/integrations.routes";
import saasRouter from "./routes/saas.routes";
import cicdRouter from "./routes/cicd.routes";
import integrationMgmtRouter from "./routes/integration-mgmt.routes";
import { metricsMiddleware, metricsEndpoint } from "./infra/metrics";

// Links for assistant context
const DEFAULT_LINKS = {
  payments: [
    { title: "Prometheus — API Metrics", url: "http://localhost:9090" },
  ],
  checkout: [
    { title: "Checkout Deploy Runbook", url: "/devflow/runbooks" },
  ],
  auth: [
    { title: "Prometheus — Auth Metrics", url: "http://localhost:9090" },
  ],
};

export function buildApp() {
  const app = express();

  // ─── Trust proxy (important for accurate IP detection behind reverse proxies) ──
  app.set("trust proxy", env.TRUST_PROXY);

  // ─── Disable fingerprinting headers ────────────────────────
  app.disable("x-powered-by");
  app.disable("etag"); // Prevent cache-based fingerprinting

  // ─── Request ID & timing (must be first) ───────────────────
  app.use(requestId);
  app.use(requestTiming);

  // ─── Security headers (Helmet — hardened configuration) ────
  app.use(
    helmet({
      // Content Security Policy — strict defaults
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      // HTTP Strict Transport Security
      hsts: {
        maxAge: SECURITY.HEADERS.HSTS_MAX_AGE,
        includeSubDomains: true,
        preload: true,
      },
      // Prevent clickjacking
      frameguard: { action: "deny" },
      // Prevent MIME-type sniffing
      noSniff: true,
      // Referrer policy  
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // Cross-Origin policies
      crossOriginEmbedderPolicy: false, // May break some CDN resources
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
      // DNS prefetch control
      dnsPrefetchControl: { allow: false },
      // IE no-open
      ieNoOpen: true,
      // Permitted cross-domain policies
      permittedCrossDomainPolicies: { permittedPolicies: "none" },
    })
  );

  // ─── Extra security headers ────────────────────────────────
  app.use(extraSecurityHeaders);

  // ─── Prometheus metrics collection ─────────────────────────
  app.use(metricsMiddleware);

  // ─── Health check (before auth/middleware) ─────────────────
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "codesila-backend", uptime: process.uptime() });
  });

  // ─── Rich health check at /api/health ──────────────────────
  app.get("/api/health", async (_req, res) => {
    let database = false;
    try { await prisma.$queryRaw`SELECT 1`; database = true; } catch {}
    res.json({ status: "ok", database, redis: false });
  });

  // ─── Prometheus metrics endpoint (§2.4.3) ──────────────────
  app.get("/metrics", metricsEndpoint);

  // ─── Test-only: reset rate-limit stores (non-production) ───
  if (env.NODE_ENV !== "production") {
    app.post("/_test/reset-rate-limits", (_req, res) => {
      authRateLimitStore.resetAll();
      apiRateLimitStore.resetAll();
      resetAllLockouts();
      res.json({ ok: true });
    });

    // Seed a GitHubRepo record for webhook E2E tests
    app.post("/_test/seed-webhook-repo", express.json(), async (req, res) => {
      try {
        const { orgId, projectId } = req.body ?? {};
        if (!orgId || !projectId) {
          return res.status(400).json({ error: "orgId and projectId are required" });
        }

        // Create a dummy GitHubInstallation if none exists for this org
        let installation = await prisma.gitHubInstallation.findUnique({ where: { orgId } });
        if (!installation) {
          const firstUser = await prisma.user.findFirst({ where: { orgId } });
          if (!firstUser) return res.status(400).json({ error: "No user found for org" });
          installation = await prisma.gitHubInstallation.create({
            data: {
              orgId,
              accessToken: "test-token",
              githubLogin: "e2e-test-org",
              connectedById: firstUser.id,
            },
          });
        }

        const webhookSecret = `e2e-secret-${Date.now()}`;
        const githubRepoId = Math.floor(100000 + Math.random() * 900000);

        const repo = await prisma.gitHubRepo.create({
          data: {
            orgId,
            projectId,
            installationId: installation.id,
            githubRepoId,
            fullName: "e2e-org/e2e-repo",
            defaultBranch: "main",
            htmlUrl: "https://github.com/e2e-org/e2e-repo",
            webhookSecret,
            trackPushes: true,
          },
        });

        return res.json({ id: repo.id, githubRepoId, webhookSecret });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    });
  }

  // ─── CORS — hardened configuration ─────────────────────────
  const origins = env.CORS_ORIGINS === "*"
    ? false  // Reject wildcard in favor of explicit origins
    : env.CORS_ORIGINS.split(",").map((o) => o.trim());

  if (env.CORS_ORIGINS === "*" && env.NODE_ENV === "production") {
    logger.warn("CORS_ORIGINS is set to '*' in production. This is a security risk.");
  }

  app.use(
    cors({
      origin: origins || "http://localhost:5173",
      methods: [...SECURITY.CORS.ALLOWED_METHODS],
      allowedHeaders: [...SECURITY.CORS.ALLOWED_HEADERS],
      credentials: true,
      maxAge: SECURITY.CORS.MAX_AGE,
      exposedHeaders: ["X-Request-ID", "RateLimit-Limit", "RateLimit-Remaining"],
    })
  );

  // ─── Cookie parser (for httpOnly cookie auth) ──────────────
  app.use(cookieParser());

  // ─── Body parsing with strict size limits ──────────────────
  app.use(express.json({ limit: SECURITY.BODY.JSON_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: SECURITY.BODY.URL_ENCODED_LIMIT }));

  // ─── Content-Type enforcement for mutation requests ────────
  app.use((req, res, next) => {
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      const ct = req.headers["content-type"];
      if (ct && !ct.includes("application/json")) {
        return res.status(415).json({ success: false, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" }, code: "UNSUPPORTED_MEDIA_TYPE" });
      }
    }
    next();
  });

  // ─── HTTP Parameter Pollution protection ───────────────────
  app.use(hpp());

  // ─── Input sanitization & attack detection ─────────────────
  app.use(inputProtection);

  // ─── General rate limiter ──────────────────────────────────
  app.use(apiRateLimiter);

  // ─── API key authentication (falls through if no API key present) ──
  app.use(apiKeyAuth);

  // ─── Usage tracking (async, non-blocking) ──────────────────
  app.use(trackUsage);

  const assistantService = new AssistantService({
    ragService: new RagService(),
    linksProvider: new StaticLinksProvider(DEFAULT_LINKS),
  });

  // AUTH (login, me) — has its own rate limiting
  app.use("/auth", authRouter);
  app.use("/api/auth", authRouter);

  // ADMIN (RBAC enforced inside routes)
  app.use("/admin", adminRouter);
  app.use("/api", adminRouter);

  // PROTECTED ASSISTANT (any logged-in user)
  app.use(
    "/assistant",
    authMiddleware,
    buildAssistantRouter(assistantService)
  );

  // PROTECTED CHAT (any logged-in user)
  app.use("/chat", authMiddleware, buildChatRouter());

  // DEVFLOW DOMAIN (RBAC protected)
  app.use("/devflow", authMiddleware, devflowRouter);

  // CI/CD PIPELINES (§3.3) — permission-based
  app.use("/api", authMiddleware, cicdRouter);

  // INTEGRATION MANAGEMENT (§3.4) — generic provider integrations
  app.use("/api", authMiddleware, integrationMgmtRouter);

  // PROJECTS (minimal vertical slice)
  app.use("/projects", authMiddleware, projectsRouter);

  // INTEGRATIONS (GitHub OAuth callback is unauthenticated; webhook has signature verification)
  // The /github/callback and /github/webhook endpoints skip authMiddleware (handled inside route)
  app.use("/integrations", integrationsRouter);

  // SAAS — Billing, subscriptions, API keys, webhooks, features, notifications, etc.
  app.use("/saas", authMiddleware, saasRouter);

  // ─── 404 handler ───────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Not found" }, code: "NOT_FOUND" });
  });

  // ─── Global error handler (must be LAST) ───────────────────
  app.use(errorHandler);

  return app;
}
