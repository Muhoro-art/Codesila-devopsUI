import { AssistantService } from "../assistant.service";
import { StaticLinksProvider } from "../links/static-links.provider";
import {
  RagService,
  type RagRetrieveInput,
  type RagRetrieveResult,
} from "../rag/rag.service";

/**
 * Temporary fake RAG (no DB required)
 */
class FakeRagService extends RagService {
  override async retrieve(_input: RagRetrieveInput): Promise<RagRetrieveResult> {
    return {
      chunks: [
        {
          id: "deploy-guide",
          text: "To deploy the service, run docker compose up -d.",
          citation: {
            title: "Deploy Guide",
            url: "local",
          },
        },
      ],
      context: [
        {
          title: "Deploy Guide",
          url: "local",
          chunk: "To deploy the service, run docker compose up -d.",
        },
      ],
      citations: [
        {
          title: "Deploy Guide",
          url: "local",
        },
      ],
    };
  }
}

async function run() {
  const linksProvider = new StaticLinksProvider({
    payments: [],
    checkout: [
      {
        title: "Checkout Deploy Runbook",
        url: "https://wiki.acme/runbooks/checkout-deploy",
      },
    ],
    auth: [],
  });

  const assistant = new AssistantService({
    ragService: new FakeRagService(),
    linksProvider,
  });

  const res = await assistant.ask({
    orgId: "org-test",
    userId: "user-test",
    query: "How do I deploy the checkout service?",
    history: [],
  });

  console.log("\n--- ASSISTANT RESPONSE ---\n");
  console.log(res.answer_md);
  console.log("\nCitations:", res.citations);
}

run().catch(console.error);
