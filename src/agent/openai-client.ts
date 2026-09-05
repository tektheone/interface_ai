import OpenAI from "openai";
import { z } from "zod";
import type { BrowserObservation } from "./observations.js";

export const DiscoveryActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("navigate"),
    target: z.string(),
    rationale: z.string()
  }),
  z.object({
    action: z.literal("click"),
    target: z.object({ kind: z.enum(["label", "text", "css", "xpath"]), value: z.string() }),
    rationale: z.string()
  }),
  z.object({
    action: z.literal("type"),
    target: z.object({ kind: z.enum(["label", "text", "css", "xpath"]), value: z.string() }),
    value: z.string(),
    rationale: z.string()
  }),
  z.object({
    action: z.literal("read"),
    outputKey: z.enum(["memberName", "savingsBalance"]),
    target: z.object({ kind: z.enum(["css", "xpath", "text"]), value: z.string() }),
    rationale: z.string()
  }),
  z.object({
    action: z.literal("done"),
    rationale: z.string()
  })
]);
export type DiscoveryAction = z.infer<typeof DiscoveryActionSchema>;

export type DiscoveryDecisionInput = {
  goal: string;
  observation: BrowserObservation;
  stepNumber: number;
  outputs: Record<string, string>;
  allowedBaseUrl: string;
  allowedRoutes: string[];
};

export type DiscoveryDecider = {
  decide(input: DiscoveryDecisionInput): Promise<DiscoveryAction>;
};

export function createOpenAIDecider(options: { apiKey?: string; model: string }): DiscoveryDecider {
  if (!options.apiKey) {
    throw new Error("OPENAI_API_KEY is required for non-mock discovery runs.");
  }

  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    async decide(input) {
      const response = await client.responses.create({
        model: options.model,
        input: [
          {
            role: "system",
            content: discoverySystemPrompt()
          },
          {
            role: "user",
            content: JSON.stringify(input, null, 2)
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "discovery_action",
            strict: false,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["action", "rationale"],
              properties: {
                action: { enum: ["navigate", "click", "type", "read", "done"] },
                target: {
                  anyOf: [
                    { type: "string" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "value"],
                      properties: {
                        kind: { enum: ["label", "text", "css", "xpath"] },
                        value: { type: "string" }
                      }
                    }
                  ]
                },
                value: { type: "string" },
                outputKey: { enum: ["memberName", "savingsBalance"] },
                rationale: { type: "string" }
              }
            }
          }
        }
      });

      return DiscoveryActionSchema.parse(normalizeDiscoveryAction(JSON.parse(response.output_text)));
    }
  };
}

export function createMockDecider(memberId: string): DiscoveryDecider {
  const actions: DiscoveryAction[] = [
    { action: "navigate", target: "/members/search", rationale: "Open the member search screen." },
    { action: "type", target: { kind: "label", value: "Member Number" }, value: memberId, rationale: "Enter the requested member number." },
    { action: "click", target: { kind: "text", value: "Search" }, rationale: "Submit the search." },
    { action: "click", target: { kind: "text", value: "Open Member Detail" }, rationale: "Open the matching member profile." },
    {
      action: "read",
      outputKey: "memberName",
      target: { kind: "xpath", value: "//th[normalize-space()='Member Name']/following-sibling::td[1]" },
      rationale: "Read the member name from the detail table."
    },
    {
      action: "read",
      outputKey: "savingsBalance",
      target: { kind: "xpath", value: "//td[normalize-space()='Savings']/following-sibling::td[1]" },
      rationale: "Read the current savings balance."
    },
    { action: "done", rationale: "The member name and savings balance have been extracted." }
  ];

  return {
    async decide(input) {
      return actions[Math.min(input.stepNumber - 1, actions.length - 1)];
    }
  };
}

function normalizeDiscoveryAction(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const action = value as { action?: string; target?: unknown; outputKey?: string };
  if ((action.action === "click" || action.action === "type") && typeof action.target === "string") {
    return { ...action, target: { kind: "text", value: action.target } };
  }

  if (action.action === "read" && typeof action.target === "string") {
    return { ...action, target: { kind: "xpath", value: readLocatorFor(action.outputKey, action.target) } };
  }

  return value;
}

function readLocatorFor(outputKey: string | undefined, fallback: string): string {
  if (outputKey === "memberName") {
    return "//th[normalize-space()='Member Name']/following-sibling::td[1]";
  }

  if (outputKey === "savingsBalance") {
    return "//td[normalize-space()='Savings']/following-sibling::td[1]";
  }

  return fallback;
}

function discoverySystemPrompt(): string {
  return `You drive a fake legacy bank back-office web app to satisfy the user's goal.
Return exactly one JSON action. Use only these actions: navigate, click, type, read, done.
Prefer visible labels/text over CSS. Do not invent data. Stop with done only after outputs are read.
Stay inside the provided allowedBaseUrl and allowedRoutes from the user payload.
If navigating, use a relative path such as /members/search, not an external domain.
When an input control already has the requested value, click the visible Search button instead of typing again.
Known useful read locators:
- memberName: xpath //th[normalize-space()='Member Name']/following-sibling::td[1]
- savingsBalance: xpath //td[normalize-space()='Savings']/following-sibling::td[1]
Stay within the local app and do not request or expose secrets.`;
}
