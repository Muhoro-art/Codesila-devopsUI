import { API_BASE, getAuthHeader, readJsonResponse } from "./client";

// ─── Plans ──────────────────────────────────────────────────

export async function listPlans() {
  const res = await fetch(`${API_BASE}/saas/plans`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ plans: Plan[] }>(res);
}

// ─── Subscription ───────────────────────────────────────────

export async function getSubscription() {
  const res = await fetch(`${API_BASE}/saas/subscription`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ subscription: Subscription | null }>(res);
}

export async function createSubscription(planId: string, billingCycle?: "MONTHLY" | "ANNUAL") {
  const res = await fetch(`${API_BASE}/saas/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ planId, billingCycle }),
  });
  return readJsonResponse<{ subscription: Subscription }>(res);
}

export async function changePlan(planId: string) {
  const res = await fetch(`${API_BASE}/saas/subscription/plan`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ planId }),
  });
  return readJsonResponse<{ subscription: Subscription }>(res);
}

export async function cancelSubscription(immediate = false) {
  const res = await fetch(`${API_BASE}/saas/subscription/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ immediate }),
  });
  return readJsonResponse<{ subscription: Subscription }>(res);
}

export async function reactivateSubscription() {
  const res = await fetch(`${API_BASE}/saas/subscription/reactivate`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ subscription: Subscription }>(res);
}

// ─── Invoices ───────────────────────────────────────────────

export async function listInvoices() {
  const res = await fetch(`${API_BASE}/saas/invoices`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ invoices: Invoice[] }>(res);
}

// ─── Limits & Usage ─────────────────────────────────────────

export async function getLimits() {
  const res = await fetch(`${API_BASE}/saas/limits`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ limits: PlanLimits }>(res);
}

export async function getUsageSummary() {
  const res = await fetch(`${API_BASE}/saas/usage`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<UsageSummary>(res);
}

// ─── Invitations ────────────────────────────────────────────

export async function listInvitations() {
  const res = await fetch(`${API_BASE}/saas/invitations`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ invitations: OrgInvitation[] }>(res);
}

export async function createInvitation(email: string, role: string) {
  const res = await fetch(`${API_BASE}/saas/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ email, role }),
  });
  return readJsonResponse<{ invitation: OrgInvitation }>(res);
}

export async function revokeInvitation(id: string) {
  const res = await fetch(`${API_BASE}/saas/invitations/${id}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

export async function resendInvitation(id: string) {
  const res = await fetch(`${API_BASE}/saas/invitations/${id}/resend`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

// ─── API Keys ───────────────────────────────────────────────

export async function listApiKeys() {
  const res = await fetch(`${API_BASE}/saas/api-keys`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ apiKeys: ApiKeyInfo[] }>(res);
}

export async function createApiKey(name: string, scopes?: string, expiresInDays?: number) {
  const res = await fetch(`${API_BASE}/saas/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ name, scopes, expiresInDays }),
  });
  return readJsonResponse<{ apiKey: ApiKeyInfo & { rawKey: string } }>(res);
}

export async function revokeApiKey(id: string) {
  const res = await fetch(`${API_BASE}/saas/api-keys/${id}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

// ─── Webhooks ───────────────────────────────────────────────

export async function listWebhooks() {
  const res = await fetch(`${API_BASE}/saas/webhooks`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ webhooks: WebhookEndpoint[] }>(res);
}

export async function createWebhook(url: string, events: string[], description?: string) {
  const res = await fetch(`${API_BASE}/saas/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ url, events, description }),
  });
  return readJsonResponse<{ webhook: WebhookEndpoint }>(res);
}

export async function deleteWebhook(id: string) {
  const res = await fetch(`${API_BASE}/saas/webhooks/${id}`, {
    method: "DELETE",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

export async function getWebhookEvents() {
  const res = await fetch(`${API_BASE}/saas/webhooks/events`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ events: string[] }>(res);
}

// ─── Features ───────────────────────────────────────────────

export async function getFeatures() {
  const res = await fetch(`${API_BASE}/saas/features`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ features: FeatureStatus[] }>(res);
}

export async function checkFeature(key: string) {
  const res = await fetch(`${API_BASE}/saas/features/check/${key}`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ key: string; enabled: boolean }>(res);
}

// ─── Notifications ──────────────────────────────────────────

export async function listNotifications(unreadOnly = false) {
  const url = `${API_BASE}/saas/notifications${unreadOnly ? "?unread=true" : ""}`;
  const res = await fetch(url, { headers: { ...getAuthHeader() } });
  return readJsonResponse<{ notifications: AppNotification[]; unreadCount: number }>(res);
}

export async function getUnreadCount() {
  const res = await fetch(`${API_BASE}/saas/notifications/unread-count`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ count: number }>(res);
}

export async function markNotificationRead(id: string) {
  const res = await fetch(`${API_BASE}/saas/notifications/${id}/read`, {
    method: "PUT",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

export async function markAllNotificationsRead() {
  const res = await fetch(`${API_BASE}/saas/notifications/read-all`, {
    method: "PUT",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

// ─── Audit Logs ─────────────────────────────────────────────

export async function listAuditLogs(params?: Record<string, string>) {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${API_BASE}/saas/audit${query}`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ auditLogs: AuditLog[]; total: number }>(res);
}

// ─── Settings ───────────────────────────────────────────────

export async function getOrgSettings() {
  const res = await fetch(`${API_BASE}/saas/settings/org`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ settings: Record<string, string> }>(res);
}

export async function updateOrgSettings(settings: Record<string, string>) {
  const res = await fetch(`${API_BASE}/saas/settings/org`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(settings),
  });
  return readJsonResponse<{ success: boolean }>(res);
}

export async function getOrgProfile() {
  const res = await fetch(`${API_BASE}/saas/settings/org/profile`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ profile: OrgProfile }>(res);
}

export async function updateOrgProfile(data: Partial<OrgProfile>) {
  const res = await fetch(`${API_BASE}/saas/settings/org/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  return readJsonResponse<{ profile: OrgProfile }>(res);
}

export async function getUserPreferences() {
  const res = await fetch(`${API_BASE}/saas/settings/user`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ preferences: Record<string, string> }>(res);
}

export async function updateUserPreferences(prefs: Record<string, string>) {
  const res = await fetch(`${API_BASE}/saas/settings/user`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(prefs),
  });
  return readJsonResponse<{ success: boolean }>(res);
}

export async function updateUserProfile(data: { name?: string; timezone?: string; locale?: string }) {
  const res = await fetch(`${API_BASE}/saas/settings/user/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(data),
  });
  return readJsonResponse(res);
}

export async function completeOnboarding() {
  const res = await fetch(`${API_BASE}/saas/settings/user/onboarding-complete`, {
    method: "POST",
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ success: boolean }>(res);
}

// ─── Data Exports ───────────────────────────────────────────

export async function listExports() {
  const res = await fetch(`${API_BASE}/saas/exports`, {
    headers: { ...getAuthHeader() },
  });
  return readJsonResponse<{ exports: DataExport[] }>(res);
}

export async function requestExport(type: string, format?: string) {
  const res = await fetch(`${API_BASE}/saas/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ type, format }),
  });
  return readJsonResponse<{ export: DataExport }>(res);
}

// ─── Types ──────────────────────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  maxUsers: number;
  maxProjects: number;
  maxStorage: number;
  maxApiCalls: number;
  maxDroplets: number;
  maxWebhooks: number;
  features: Record<string, boolean>;
  sortOrder: number;
}

export interface Subscription {
  id: string;
  orgId: string;
  planId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  trialEndsAt: string | null;
  billingCycle: string;
  quantity: number;
  plan: Plan;
  invoices?: Invoice[];
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  paidAt: string | null;
}

export interface PlanLimits {
  maxUsers: number;
  maxProjects: number;
  maxStorage: number;
  maxApiCalls: number;
  maxDroplets: number;
  maxWebhooks: number;
  planName: string;
  features: Record<string, boolean>;
}

export interface UsageSummary {
  currentPeriod: Record<string, number>;
  resources: { users: number; projects: number; droplets: number };
  limits: { maxUsers: number; maxProjects: number; maxStorage: number; maxApiCalls: number; maxDroplets: number } | null;
  plan: string;
  subscription: { status: string; billingCycle: string; currentPeriodEnd: string } | null;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string; email: string };
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rateLimit: number;
  createdAt: string;
  owner?: { id: string; name: string; email: string };
  rawKey?: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string;
  status: string;
  lastTriggeredAt: string | null;
  failureCount: number;
  createdAt: string;
}

export interface FeatureStatus {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  source: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  project: { id: string; name: string } | null;
}

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  domain: string | null;
  industry: string | null;
  size: string;
  createdAt: string;
  _count: { users: number; projects: number };
}

export interface DataExport {
  id: string;
  type: string;
  status: string;
  format: string;
  fileUrl: string | null;
  fileSize: number | null;
  expiresAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}
