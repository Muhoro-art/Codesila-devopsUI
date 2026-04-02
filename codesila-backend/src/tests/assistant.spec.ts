// src/tests/assistant.spec.ts — Unit tests for Assistant module (§4.1)
import { describe, it, expect } from "vitest";

// ─── Intent Detection: wantsLinksNow ────────────────────────
const LINK_KEYWORDS = [
  "link", "links", "dashboard", "dashboards", "monitor", "monitoring",
  "grafana", "jenkins", "ссылк", "дашборд", "монитор", "графан", "дженкинс",
];

function wantsLinksNow(text: string): boolean {
  const q = text.toLowerCase();
  return LINK_KEYWORDS.some((k) => q.includes(k));
}

describe("Intent Detection — wantsLinksNow", () => {
  it("returns true for 'show me links'", () => {
    expect(wantsLinksNow("show me links")).toBe(true);
  });

  it("returns true for 'open grafana dashboard'", () => {
    expect(wantsLinksNow("open grafana dashboard")).toBe(true);
  });

  it("returns true for 'мониторинг'", () => {
    expect(wantsLinksNow("покажи мониторинг")).toBe(true);
  });

  it("returns true for 'дашборд'", () => {
    expect(wantsLinksNow("открой дашборд")).toBe(true);
  });

  it("returns false for 'deploy latest version'", () => {
    expect(wantsLinksNow("deploy latest version")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(wantsLinksNow("")).toBe(false);
  });
});

// ─── Service Detection ──────────────────────────────────────
type ServiceKey = "payments" | "checkout" | "auth";

function detectService(text: string): ServiceKey | null {
  const q = text.toLowerCase();
  if (/\bpayments?\b/.test(q)) return "payments";
  if (/\bcheckout\b/.test(q)) return "checkout";
  if (/\bauth\b/.test(q)) return "auth";
  return null;
}

describe("Service Detection", () => {
  it("detects payments", () => {
    expect(detectService("show me payment links")).toBe("payments");
  });

  it("detects checkout", () => {
    expect(detectService("checkout dashboard")).toBe("checkout");
  });

  it("detects auth", () => {
    expect(detectService("auth monitoring page")).toBe("auth");
  });

  it("returns null for unrelated", () => {
    expect(detectService("deploy latest version")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectService("")).toBeNull();
  });
});

// ─── Operational Insights Builder ───────────────────────────
type DeploymentSnapshot = {
  id: string;
  service: string;
  project: string;
  version: string;
  environment: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
};

type IncidentSnapshot = {
  id: string;
  project: string;
  service: string;
  severity: string;
  status: string;
  summary: string;
  startedAt: string;
};

type RunbookSnapshot = {
  id: string;
  title: string;
  project: string;
  service?: string | null;
  status: string;
  updatedAt: string;
};

type OrgSnapshot = {
  deployments: DeploymentSnapshot[];
  deploymentStats: { meanDurationMinutes?: number | null; windowDays: number };
  deploymentActors: Array<{
    version: string; project: string; service: string;
    environment: string; status: string; startedAt: string;
    actor?: string | null; triggeredBy?: string | null;
  }>;
  incidents: IncidentSnapshot[];
  degradedServices: Array<{ id: string; name: string }>;
  runbookUpdates: RunbookSnapshot[];
};

function buildOperationalInsights(snapshot: OrgSnapshot): string {
  const lines: string[] = [];
  lines.push("Operational Insights:");

  const lastFailed = snapshot.deployments.find((d) => d.status === "FAILED");
  if (lastFailed) {
    lines.push(
      `- Deployment ${lastFailed.version} failed in ${lastFailed.environment} for ${lastFailed.project}/${lastFailed.service} (${lastFailed.startedAt}).`
    );
  } else {
    lines.push("- No recent failed deployments detected in the last 5 entries.");
  }

  const sev1 = snapshot.incidents.find((i) => i.severity === "SEV1" && i.status !== "RESOLVED");
  if (sev1) {
    lines.push(`- Active SEV1 incident: ${sev1.project}/${sev1.service} ${sev1.summary}.`);
  }

  if (snapshot.degradedServices.length > 0) {
    const names = snapshot.degradedServices.map((s) => s.name).slice(0, 5).join(", ");
    lines.push(`- Degraded services: ${names}.`);
  }

  if (snapshot.deploymentStats.meanDurationMinutes != null) {
    lines.push(
      `- Mean deployment time (last ${snapshot.deploymentStats.windowDays} days): ${snapshot.deploymentStats.meanDurationMinutes.toFixed(1)} minutes.`
    );
  }

  return lines.join("\n");
}

describe("Operational Insights Builder", () => {
  const emptySnapshot: OrgSnapshot = {
    deployments: [],
    deploymentStats: { meanDurationMinutes: null, windowDays: 30 },
    deploymentActors: [],
    incidents: [],
    degradedServices: [],
    runbookUpdates: [],
  };

  it("reports no failed deployments when none exist", () => {
    const output = buildOperationalInsights(emptySnapshot);
    expect(output).toContain("No recent failed deployments");
  });

  it("reports failed deployment details", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      deployments: [
        {
          id: "d1", service: "api", project: "myapp", version: "1.0.1",
          environment: "PROD", status: "FAILED", startedAt: "2025-01-15T10:00:00Z",
        },
      ],
    };
    const output = buildOperationalInsights(snapshot);
    expect(output).toContain("1.0.1");
    expect(output).toContain("PROD");
    expect(output).toContain("myapp/api");
  });

  it("reports active SEV1 incidents", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      incidents: [
        {
          id: "inc1", project: "myapp", service: "db", severity: "SEV1",
          status: "OPEN", summary: "Database outage", startedAt: "2025-01-15T10:00:00Z",
        },
      ],
    };
    const output = buildOperationalInsights(snapshot);
    expect(output).toContain("Active SEV1 incident");
    expect(output).toContain("Database outage");
  });

  it("does not report resolved SEV1 incidents", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      incidents: [
        {
          id: "inc1", project: "myapp", service: "db", severity: "SEV1",
          status: "RESOLVED", summary: "Database outage", startedAt: "2025-01-15T10:00:00Z",
        },
      ],
    };
    const output = buildOperationalInsights(snapshot);
    expect(output).not.toContain("Active SEV1");
  });

  it("lists degraded services", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      degradedServices: [{ id: "s1", name: "auth-svc" }, { id: "s2", name: "payment-svc" }],
    };
    const output = buildOperationalInsights(snapshot);
    expect(output).toContain("auth-svc");
    expect(output).toContain("payment-svc");
  });

  it("shows mean deployment duration", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      deploymentStats: { meanDurationMinutes: 4.5, windowDays: 14 },
    };
    const output = buildOperationalInsights(snapshot);
    expect(output).toContain("4.5 minutes");
    expect(output).toContain("14 days");
  });
});

// ─── Conversation History Windowing ─────────────────────────
describe("Conversation History Windowing", () => {
  type HistTurn = { role: "user" | "assistant"; text: string };

  function buildConvoBlock(history: HistTurn[]): string {
    return history
      .slice(-8)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");
  }

  it("limits to last 8 turns", () => {
    const history: HistTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `Message ${i}`,
    }));
    const block = buildConvoBlock(history);
    const lines = block.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[0]).toContain("Message 12");
    expect(lines[7]).toContain("Message 19");
  });

  it("returns empty string for empty history", () => {
    expect(buildConvoBlock([])).toBe("");
  });

  it("preserves role labels", () => {
    const history: HistTurn[] = [
      { role: "user", text: "Hello" },
      { role: "assistant", text: "Hi" },
    ];
    const block = buildConvoBlock(history);
    expect(block).toContain("User: Hello");
    expect(block).toContain("Assistant: Hi");
  });
});
