-- CreateEnum
CREATE TYPE "OrgSize" AS ENUM ('SOLO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED', 'UNPAID');
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');
CREATE TYPE "UsageMetric" AS ENUM ('API_CALLS', 'STORAGE_BYTES', 'CI_BUILDS', 'DEPLOYMENTS', 'ACTIVE_USERS', 'CHAT_MESSAGES', 'ASSISTANT_QUERIES', 'BANDWIDTH_BYTES');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'BILLING', 'INVITATION', 'DEPLOYMENT', 'INCIDENT', 'SECURITY', 'USAGE_WARNING', 'FEATURE_UPDATE');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'BOTH');
CREATE TYPE "DataExportType" AS ENUM ('FULL_ORG', 'USER_DATA', 'AUDIT_LOGS', 'PROJECTS', 'BILLING');
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- AlterTable: users
ALTER TABLE "users" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "users" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "users" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "users" ADD COLUMN "onboardingComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "lastLoginIp" TEXT;

-- AlterTable: organizations
ALTER TABLE "organizations" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "organizations" ADD COLUMN "domain" TEXT;
ALTER TABLE "organizations" ADD COLUMN "industry" TEXT;
ALTER TABLE "organizations" ADD COLUMN "size" "OrgSize" NOT NULL DEFAULT 'SMALL';

-- CreateIndex
CREATE UNIQUE INDEX "organizations_domain_key" ON "organizations"("domain");

-- CreateTable: plans
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" INTEGER NOT NULL DEFAULT 0,
    "annualPrice" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "maxProjects" INTEGER NOT NULL DEFAULT 3,
    "maxStorage" BIGINT NOT NULL DEFAULT 1073741824,
    "maxApiCalls" INTEGER NOT NULL DEFAULT 10000,
    "maxDroplets" INTEGER NOT NULL DEFAULT 1,
    "maxWebhooks" INTEGER NOT NULL DEFAULT 3,
    "features" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateTable: subscriptions
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_orgId_key" ON "subscriptions"("orgId");
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateTable: invoices
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountDue" INTEGER NOT NULL DEFAULT 0,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "stripeInvoiceId" TEXT,
    "hostedInvoiceUrl" TEXT,
    "pdfUrl" TEXT,
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE INDEX "invoices_subscriptionId_idx" ON "invoices"("subscriptionId");

-- CreateTable: usage_records
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_records_orgId_metric_periodStart_idx" ON "usage_records"("orgId", "metric", "periodStart");

-- CreateTable: org_invitations
CREATE TABLE "org_invitations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_invitations_token_key" ON "org_invitations"("token");
CREATE UNIQUE INDEX "org_invitations_orgId_email_key" ON "org_invitations"("orgId", "email");
CREATE INDEX "org_invitations_token_idx" ON "org_invitations"("token");

-- CreateTable: api_keys
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'read',
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX "api_keys_orgId_idx" ON "api_keys"("orgId");
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateTable: webhook_endpoints
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastTriggeredAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_orgId_idx" ON "webhook_endpoints"("orgId");

-- CreateTable: webhook_deliveries
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "duration" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt");

-- CreateTable: feature_flags
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultOn" BOOLEAN NOT NULL DEFAULT false,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateTable: feature_overrides
CREATE TABLE "feature_overrides" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "feature_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_overrides_orgId_flagId_key" ON "feature_overrides"("orgId", "flagId");

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX "notifications_orgId_idx" ON "notifications"("orgId");

-- CreateTable: org_settings
CREATE TABLE "org_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_settings_orgId_key_key" ON "org_settings"("orgId", "key");

-- CreateTable: user_preferences
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_preferences_userId_key_key" ON "user_preferences"("userId", "key");

-- CreateTable: data_exports
CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "type" "DataExportType" NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "format" TEXT NOT NULL DEFAULT 'json',
    "fileUrl" TEXT,
    "fileSize" BIGINT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_exports_orgId_idx" ON "data_exports"("orgId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default plans
INSERT INTO "plans" ("id", "name", "displayName", "description", "monthlyPrice", "annualPrice", "maxUsers", "maxProjects", "maxStorage", "maxApiCalls", "maxDroplets", "maxWebhooks", "sortOrder", "features", "createdAt", "updatedAt")
VALUES
  ('plan_free',        'free',         'Free',          'For individuals and small experiments',     0,      0,      5,    3,    1073741824,    10000,   1,  3,  0, '{"chat":true,"assistant":true,"github_integration":false,"sso":false,"audit_log":false,"custom_domain":false,"priority_support":false,"advanced_analytics":false}', NOW(), NOW()),
  ('plan_starter',     'starter',      'Starter',       'For small teams getting started',         2900,  29000,     15,   10,   5368709120,    50000,   3,  5,  1, '{"chat":true,"assistant":true,"github_integration":true,"sso":false,"audit_log":true,"custom_domain":false,"priority_support":false,"advanced_analytics":false}', NOW(), NOW()),
  ('plan_professional','professional', 'Professional',  'For growing teams with advanced needs',   7900,  79000,     50,   50,  53687091200,   200000,  10, 20,  2, '{"chat":true,"assistant":true,"github_integration":true,"sso":true,"audit_log":true,"custom_domain":true,"priority_support":true,"advanced_analytics":true}', NOW(), NOW()),
  ('plan_enterprise',  'enterprise',   'Enterprise',    'For large organizations with custom needs', 0,      0,   9999, 9999, 1099511627776, 9999999, 999, 999, 3, '{"chat":true,"assistant":true,"github_integration":true,"sso":true,"audit_log":true,"custom_domain":true,"priority_support":true,"advanced_analytics":true,"dedicated_support":true,"custom_integrations":true}', NOW(), NOW());

-- Seed default feature flags
INSERT INTO "feature_flags" ("id", "key", "name", "description", "defaultOn", "isGlobal", "createdAt", "updatedAt")
VALUES
  ('ff_chat',                'chat',                'Real-time Chat',          'Team chat functionality',                     true,  false, NOW(), NOW()),
  ('ff_assistant',           'assistant',           'AI Assistant',            'AI-powered coding assistant',                 true,  false, NOW(), NOW()),
  ('ff_github',              'github_integration',  'GitHub Integration',      'Connect GitHub repos and track activity',     false, false, NOW(), NOW()),
  ('ff_sso',                 'sso',                 'Single Sign-On',          'SAML/OIDC SSO for enterprise auth',           false, false, NOW(), NOW()),
  ('ff_audit',               'audit_log',           'Audit Log',              'Detailed audit trail of all actions',          false, false, NOW(), NOW()),
  ('ff_custom_domain',       'custom_domain',       'Custom Domain',          'Use your own domain for the platform',         false, false, NOW(), NOW()),
  ('ff_priority_support',    'priority_support',    'Priority Support',       '24/7 priority support with SLA',              false, false, NOW(), NOW()),
  ('ff_advanced_analytics',  'advanced_analytics',  'Advanced Analytics',     'Detailed usage and performance analytics',     false, false, NOW(), NOW()),
  ('ff_api_access',          'api_access',          'API Access',             'Programmatic API key access',                  true,  false, NOW(), NOW()),
  ('ff_webhooks',            'webhooks',            'Webhooks',               'Event-driven webhook notifications',           true,  false, NOW(), NOW()),
  ('ff_data_export',         'data_export',         'Data Export',            'Export organization data (GDPR)',              true,  true,  NOW(), NOW()),
  ('ff_2fa',                 'two_factor_auth',     'Two-Factor Auth',        'TOTP-based two-factor authentication',        true,  true,  NOW(), NOW());
