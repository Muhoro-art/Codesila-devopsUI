import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../../config/env";
import { RagService, type RagContextItem } from "./rag/rag.service";
import { OrgContextLoader } from "./context.loader";
import { AGENT_TOOLS, executeTool, type ToolContext } from "./agent-tools";
import logger from "../../config/logger";

/**
 * Conversation history turn
 */
export type HistTurn = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Links provider contract
 */
export type ServiceKey = "payments" | "checkout" | "auth";

export type LinkItem = {
  title: string;
  url: string;
};

export interface LinksProvider {
  getLinks(orgId: string, service: ServiceKey): Promise<LinkItem[]>;
}

const LINK_KEYWORDS = [
  "link", "links", "dashboard", "dashboards", "monitor", "monitoring", "grafana", "jenkins",
  "ссылк", "дашборд", "монитор", "графан", "дженкинс",
];

const SYSTEM_PROMPT = `You are CodeSila Autonomous DevOps Agent, an AI assistant embedded in the CodeSila platform that can both answer questions AND execute real DevOps actions.

You have access to tools that let you:
- List projects, deployments, incidents, runbooks, pipeline status
- Trigger real deployments to registered targets (via SSH + Docker)
- Trigger full CI/CD pipeline runs (build → test → deploy)
- Create and update incidents
- Roll back deployments to previous versions
- Check deployment targets and their configuration
- Create GitHub/GitLab repos and link them to projects
- Generate full project scaffolds (code, configs, Docker, CI pipelines) using GitHub AI models and push them to linked repos in a single atomic commit — use scaffold_project when the user asks to set up, initialize, or generate architecture for a project

RULES:
1. Use clean Markdown. Use tables, bullet lists, and headings for readability.
2. Be specific — reference actual names, dates, versions, and statuses from the data. Never fabricate.
3. When the user asks you to DO something (deploy, create incident, trigger pipeline, rollback), USE YOUR TOOLS to actually do it — don't just describe how.
4. Before executing destructive actions (deployments to PRODUCTION, rollbacks), briefly confirm what you're about to do, then proceed.
5. After executing an action, report the result clearly with status, IDs, and next steps.
6. If information is not in the context or tool results, say so — don't guess.
7. Keep answers concise but complete. Lead with the action or answer.
8. When you use a tool, explain what you did and show the result in a user-friendly format.
9. You can chain multiple tool calls to complete complex tasks (e.g., check status → find issue → create incident → notify).`;

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
  github: { connected: boolean; login: string | null };
  projects: Array<{
    id: string;
    name: string;
    key: string;
    type: string;
    status: string;
    description: string | null;
    createdAt: string;
    owner: string;
    members: string[];
    repoCount: number;
    memberCount: number;
    repos: Array<{ fullName: string; defaultBranch: string }>;
  }>;
  recentCommits: Array<{
    repo: string;
    sha: string;
    message: string;
    author: string;
    branch: string;
    timestamp: string;
    additions: number;
    deletions: number;
  }>;
  ciBuilds: Array<{
    repo: string;
    project: string;
    workflow: string | null;
    branch: string;
    status: string;
    conclusion: string | null;
    startedAt: string;
  }>;
  deployments: DeploymentSnapshot[];
  deploymentStats: {
    meanDurationMinutes?: number | null;
    windowDays: number;
  };
  deploymentActors: Array<{
    version: string;
    project: string;
    service: string;
    environment: string;
    status: string;
    startedAt: string;
    actor?: string | null;
    triggeredBy?: string | null;
  }>;
  incidents: IncidentSnapshot[];
  degradedServices: Array<{ id: string; name: string }>;
  runbookUpdates: RunbookSnapshot[];
};

/**
 * Intent helpers
 */
function wantsLinksNow(text: string): boolean {
  const q = text.toLowerCase();
  return LINK_KEYWORDS.some((k) => q.includes(k));
}

function detectService(text: string): ServiceKey | null {
  const q = text.toLowerCase();
  if (/\bpayments?\b/.test(q)) return "payments";
  if (/\bcheckout\b/.test(q)) return "checkout";
  if (/\bauth\b/.test(q)) return "auth";
  return null;
}

function buildOperationalInsights(snapshot: OrgSnapshot): string {
  const lines: string[] = [];
  lines.push("Operational Insights:");

  const lastFailed = snapshot.deployments.find((d) => d.status === "FAILED");
  if (lastFailed) {
    const similar = snapshot.deployments.find(
      (d) =>
        d.id !== lastFailed.id &&
        d.status === "FAILED" &&
        d.service === lastFailed.service &&
        d.project === lastFailed.project
    );

    lines.push(
      `- Deployment ${lastFailed.version} failed in ${lastFailed.environment} for ${lastFailed.project}/${lastFailed.service} (${lastFailed.startedAt}).`
    );

    if (similar) {
      lines.push(
        `- Similar failure pattern for ${similar.project}/${similar.service} at ${similar.startedAt} (version ${similar.version}).`
      );
    }

    const runbook = snapshot.runbookUpdates.find(
      (r) => r.project === lastFailed.project && (!r.service || r.service === lastFailed.service)
    );
    if (runbook) {
      lines.push(`- Recommended action: review runbook "${runbook.title}" (${runbook.project}).`);
    }
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

  const lastActor = snapshot.deploymentActors[0];
  if (lastActor?.actor) {
    lines.push(
      `- Last deployment by ${lastActor.actor}: ${lastActor.project}/${lastActor.service} ${lastActor.version} ${lastActor.environment} ${lastActor.status}.`
    );
  }

  // CI/CD insights
  const failedBuilds = snapshot.ciBuilds.filter((b) => b.conclusion === "failure");
  if (failedBuilds.length > 0) {
    lines.push(`- ${failedBuilds.length} failed CI build(s) recently.`);
    const first = failedBuilds[0];
    lines.push(`  Latest failure: ${first.repo} ${first.workflow} on ${first.branch} (${first.startedAt}).`);
  }

  // Project overview
  if (snapshot.projects.length > 0) {
    lines.push(`- ${snapshot.projects.length} project(s) in org.`);
  }

  return lines.join("\n");
}

/**
 * Assistant Service
 * Pure orchestration. No HTTP. No framework.
 */
export class AssistantService {
  private openai: OpenAI;
  private rag: RagService;
  private links: LinksProvider;
  private orgContext: OrgContextLoader;

  constructor(deps: {
    ragService: RagService;
    linksProvider: LinksProvider;
  }) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    this.rag = deps.ragService;
    this.links = deps.linksProvider;
    this.orgContext = new OrgContextLoader();
  }

  /**
   * Main entrypoint — agentic loop with function calling
   */
  async ask(input: {
    orgId: string;
    userId: string;
    query: string;
    history?: HistTurn[];
    projectId?: string;
  }): Promise<{
    answer_md: string;
    citations?: { title: string; url: string | null }[];
    suggestions?: string[];
    toolCalls?: Array<{ name: string; args: any; result: string }>;
  }> {
    const { orgId, userId, query, history = [], projectId } = input;
    const current = String(query || "").trim();

    // ---- rolling convo window ----
    const convo = history
      .slice(-8)
      .map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`
      )
      .join("\n");

    // ---- intent: links shortcut ----
    const service = detectService(current);
    if (wantsLinksNow(current) && service) {
      const links = await this.links.getLinks(orgId, service);

      if (links.length > 0) {
        return {
          answer_md:
            `Here are the links for **${service}**:\n\n` +
            links
              .map((l: LinkItem) => `- [${l.title}](${l.url})`)
              .join("\n"),
          citations: links.slice(0, 3).map((l) => ({
            title: l.title,
            url: l.url,
          })),
          suggestions: links.slice(0, 3).map((l) => l.title),
        };
      }
    }

    const orgSnapshot = await this.orgContext.load(orgId, { projectId });
    const orgContextBlock = this.orgContext.buildContextBlock(orgSnapshot);
    const insightBlock = buildOperationalInsights(orgSnapshot);

    // ---- RAG retrieval ----
    const ragResult = await this.rag.retrieve({
      orgId,
      query: current,
      conversationHint: convo,
      topK: 6,
    });

    const ragContextBlock =
      ragResult.context.length > 0
        ? ragResult.context
            .map(
              (c: RagContextItem, i: number) =>
                `DOC ${i + 1}: ${c.title ?? "Untitled"} (${c.url ?? "local"})\n${c.chunk}`
            )
            .join("\n\n")
        : "(no retrieved context)";

    // ---- Build messages for the agentic loop ----
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Conversation history:\n${convo || "(no prior messages)"}`,
      },
      {
        role: "user",
        content: `Platform context:\n${insightBlock}\n\n${orgContextBlock}\n\n${ragContextBlock}`,
      },
      {
        role: "user",
        content: current,
      },
    ];

    const toolCtx: ToolContext = { orgId, userId };
    const executedTools: Array<{ name: string; args: any; result: string }> = [];

    // ---- Agentic loop — up to 5 tool call rounds ----
    for (let round = 0; round < 5; round++) {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools: AGENT_TOOLS,
        tool_choice: round === 0 ? "auto" : "auto",
      });

      const choice = response.choices[0];
      if (!choice) break;

      // If the model wants to call tools
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
        // Add assistant message with tool calls
        messages.push(choice.message);

        // Execute each tool call
        for (const tc of choice.message.tool_calls) {
          const args = JSON.parse(tc.function.arguments || "{}");
          logger.info({ tool: tc.function.name, args }, "Agent executing tool");

          const result = await executeTool(tc.function.name, args, toolCtx);
          executedTools.push({ name: tc.function.name, args, result });

          // Add tool result back to messages
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }
        // Continue loop so model can process results or call more tools
        continue;
      }

      // Model returned a text response — we're done
      const finalText = choice.message?.content ?? "No response.";
      return {
        answer_md: finalText,
        citations: ragResult.citations,
        toolCalls: executedTools.length > 0 ? executedTools : undefined,
      };
    }

    // Fallback if loop exhausted
    return {
      answer_md: "I executed the requested actions. Check the tool results above for details.",
      toolCalls: executedTools.length > 0 ? executedTools : undefined,
    };
  }
}
