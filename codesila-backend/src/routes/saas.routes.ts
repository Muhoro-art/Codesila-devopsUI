/**
 * Main SaaS routes — mounts all SaaS sub-modules under /saas
 */
import { Router } from "express";
import billingRoutes from "../modules/saas/billing/billing.routes";
import invitationRoutes from "../modules/saas/invitations/invitations.routes";
import apiKeyRoutes from "../modules/saas/apikeys/apikeys.routes";
import webhookRoutes from "../modules/saas/webhooks/webhooks.routes";
import featureRoutes from "../modules/saas/features/features.routes";
import notificationRoutes from "../modules/saas/notifications/notifications.routes";
import usageRoutes from "../modules/saas/usage/usage.routes";
import settingsRoutes from "../modules/saas/settings/settings.routes";
import exportRoutes from "../modules/saas/exports/exports.routes";
import auditRoutes from "../modules/saas/audit/audit.routes";

const router = Router();

// Billing & Subscription management
router.use("/", billingRoutes);

// Team invitations
router.use("/invitations", invitationRoutes);

// API key management
router.use("/api-keys", apiKeyRoutes);

// Webhook management
router.use("/webhooks", webhookRoutes);

// Feature flags
router.use("/features", featureRoutes);

// Notifications
router.use("/notifications", notificationRoutes);

// Usage metering
router.use("/usage", usageRoutes);

// Settings (org + user)
router.use("/settings", settingsRoutes);

// Data exports
router.use("/exports", exportRoutes);

// Audit logs
router.use("/audit", auditRoutes);

export default router;
