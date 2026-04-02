import { prisma } from "../../../infra/db";
import crypto from "crypto";

export async function createWebhookEndpoint(data: {
  orgId: string;
  url: string;
  description?: string;
  events: string[];
}) {
  const secret = "whsec_" + crypto.randomBytes(24).toString("hex");

  return prisma.webhookEndpoint.create({
    data: {
      orgId: data.orgId,
      url: data.url,
      description: data.description,
      secret,
      events: data.events.join(","),
      status: "ACTIVE",
    },
  });
}

export async function listWebhookEndpoints(orgId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      description: true,
      events: true,
      status: true,
      lastTriggeredAt: true,
      failureCount: true,
      createdAt: true,
    },
  });
}

export async function getWebhookEndpoint(id: string, orgId: string) {
  return prisma.webhookEndpoint.findFirst({
    where: { id, orgId },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

export async function updateWebhookEndpoint(id: string, orgId: string, data: {
  url?: string;
  description?: string;
  events?: string[];
  status?: "ACTIVE" | "PAUSED" | "DISABLED";
}) {
  const update: Record<string, unknown> = {};
  if (data.url) update.url = data.url;
  if (data.description !== undefined) update.description = data.description;
  if (data.events) update.events = data.events.join(",");
  if (data.status) update.status = data.status;

  return prisma.webhookEndpoint.updateMany({
    where: { id, orgId },
    data: update,
  });
}

export async function deleteWebhookEndpoint(id: string, orgId: string) {
  return prisma.webhookEndpoint.deleteMany({
    where: { id, orgId },
  });
}

export async function rotateWebhookSecret(id: string, orgId: string) {
  const newSecret = "whsec_" + crypto.randomBytes(24).toString("hex");
  await prisma.webhookEndpoint.updateMany({
    where: { id, orgId },
    data: { secret: newSecret },
  });
  return newSecret;
}

// ─── Webhook Delivery (fire & forget) ──────────────────────

export async function dispatchWebhook(orgId: string, event: string, payload: Record<string, unknown>) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      orgId,
      status: "ACTIVE",
    },
  });

  const matchingEndpoints = endpoints.filter((ep) => {
    const events = ep.events.split(",").map((e) => e.trim());
    return events.includes(event) || events.includes("*");
  });

  for (const endpoint of matchingEndpoints) {
    const startTime = Date.now();
    let responseStatus: number | null = null;
    let responseBody = "";
    let success = false;
    let error: string | null = null;

    try {
      const signature = crypto
        .createHmac("sha256", endpoint.secret)
        .update(JSON.stringify(payload))
        .digest("hex");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": event,
          "X-Webhook-Id": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      responseStatus = response.status;
      responseBody = await response.text().catch(() => "");
      success = response.ok;
    } catch (err: any) {
      error = err.message;
    }

    const duration = Date.now() - startTime;

    // Log delivery
    await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: payload as any,
        responseStatus,
        responseBody: responseBody?.slice(0, 2000),
        success,
        duration,
        error,
      },
    });

    // Update endpoint stats
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        lastTriggeredAt: new Date(),
        failureCount: success ? 0 : { increment: 1 },
      },
    });

    // Auto-disable after 10 consecutive failures
    if (!success) {
      const ep = await prisma.webhookEndpoint.findUnique({ where: { id: endpoint.id } });
      if (ep && ep.failureCount >= 10) {
        await prisma.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { status: "DISABLED" },
        });
      }
    }
  }
}
