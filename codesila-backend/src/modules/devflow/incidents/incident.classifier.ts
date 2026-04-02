import OpenAI from "openai";

export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";

export type IncidentClassifierInput = {
  summary: string;
  description?: string | null;
  environment?: string | null;
  status?: string | null;
  serviceName?: string | null;
  projectName?: string | null;
  deploymentStatus?: string | null;
};

const SEV1_KEYWORDS = [
  "outage",
  "down",
  "data loss",
  "breach",
  "security incident",
  "sev1",
  "sev-1",
  "p0",
  "p1",
  "unavailable",
  "total failure",
];

const SEV2_KEYWORDS = [
  "degraded",
  "partial outage",
  "high latency",
  "timeouts",
  "error spike",
  "failure rate",
  "sev2",
  "sev-2",
  "p2",
];

const SEV3_KEYWORDS = [
  "minor",
  "intermittent",
  "limited impact",
  "low impact",
  "sev3",
  "sev-3",
  "p3",
];

const SEV4_KEYWORDS = [
  "cosmetic",
  "typo",
  "ui glitch",
  "sev4",
  "sev-4",
  "p4",
];

function normalize(text: string) {
  return text.toLowerCase();
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((k) => text.includes(k));
}

function ruleBasedSeverity(input: IncidentClassifierInput): IncidentSeverity {
  const summary = normalize(input.summary ?? "");
  const description = normalize(input.description ?? "");
  const combined = `${summary} ${description}`.trim();

  if (containsAny(combined, SEV1_KEYWORDS)) return "SEV1";
  if (containsAny(combined, SEV2_KEYWORDS)) return "SEV2";
  if (containsAny(combined, SEV3_KEYWORDS)) return "SEV3";
  if (containsAny(combined, SEV4_KEYWORDS)) return "SEV4";

  if (input.deploymentStatus && normalize(input.deploymentStatus).includes("failed")) {
    return "SEV2";
  }

  if (combined.length >= 160) return "SEV2";
  if (combined.length >= 80) return "SEV3";

  return "SEV4";
}

function isSeverity(value: string): value is IncidentSeverity {
  return value === "SEV1" || value === "SEV2" || value === "SEV3" || value === "SEV4";
}

async function llmSeverity(input: IncidentClassifierInput, fallback: IncidentSeverity) {
  if (process.env.INCIDENT_SEVERITY_LLM !== "true") return fallback;
  if (!process.env.OPENAI_API_KEY) return fallback;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = [
    "Classify incident severity as one of: SEV1, SEV2, SEV3, SEV4.",
    "Use the summary/description, environment, and deployment status.",
    "Return only the severity token.",
    "",
    `Summary: ${input.summary}`,
    `Description: ${input.description ?? ""}`,
    `Environment: ${input.environment ?? ""}`,
    `Status: ${input.status ?? ""}`,
    `Service: ${input.serviceName ?? ""}`,
    `Project: ${input.projectName ?? ""}`,
    `DeploymentStatus: ${input.deploymentStatus ?? ""}`,
    `RuleBased: ${fallback}`,
  ].join("\n");

  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You are a careful incident triage assistant." },
        { role: "user", content: prompt },
      ],
    });

    const raw = (response.output_text ?? "").trim().toUpperCase();
    if (isSeverity(raw)) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

export async function classifyIncidentSeverity(input: IncidentClassifierInput): Promise<IncidentSeverity> {
  const ruleBased = ruleBasedSeverity(input);
  return llmSeverity(input, ruleBased);
}
