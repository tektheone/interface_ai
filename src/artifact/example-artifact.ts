import { ArtifactSchemaVersion, type CapabilityArtifactInput } from "./schema.js";

export const lookupMemberSavingsBalanceArtifact: CapabilityArtifactInput = {
  schemaVersion: ArtifactSchemaVersion,
  capability: {
    name: "lookup_member_savings_balance",
    version: "0.1.0",
    description: "Look up a member by member number and return the current savings balance from the fake core servicing app.",
    createdAt: "2026-09-04T00:00:00.000Z",
    source: "human_authored",
    reviewStatus: "draft"
  },
  targetApp: {
    name: "Northstar CoreServicing",
    vendor: "FakeCore",
    surface: "legacy_web",
    baseUrl: "http://localhost:3000",
    version: "demo-1",
    tenantScope: "vendor_version"
  },
  inputs: {
    memberId: {
      type: "string",
      description: "Five-digit fake member number to search for.",
      required: true,
      sensitive: false,
      redaction: "none",
      example: "12345"
    }
  },
  outputs: {
    memberName: {
      type: "string",
      description: "Member display name shown on the profile page.",
      sensitive: true,
      redaction: "partial",
      nullable: false
    },
    savingsBalance: {
      type: "currency",
      description: "Current savings account balance.",
      sensitive: true,
      redaction: "partial",
      nullable: false
    }
  },
  policy: {
    allowedOrigins: ["http://localhost:3000"],
    allowedRoutes: ["/", "/members/search", "/members/:memberId"],
    allowedActions: ["navigate", "click", "type", "read", "wait_for", "assert", "handoff"],
    blockedRiskLevels: ["irreversible"],
    requireHumanForRiskLevels: ["risky", "irreversible"],
    redactInputKeys: [],
    redactOutputKeys: ["memberName", "savingsBalance"]
  },
  steps: [
    {
      id: "open-member-search",
      description: "Navigate to the member search screen.",
      action: "navigate",
      riskLevel: "safe",
      value: { template: "/members/search", sensitive: false },
      expected: [
        {
          type: "text_visible",
          description: "Member Search page is visible.",
          value: "Member Search",
          timeoutMs: 5_000
        }
      ]
    },
    {
      id: "enter-member-number",
      description: "Enter the supplied member number into the legacy search form.",
      action: "type",
      riskLevel: "safe",
      target: {
        primary: {
          kind: "label",
          value: "Member Number",
          robustness: "Label text mirrors what a human operator sees and survives DOM reshuffling."
        },
        fallbacks: [
          {
            kind: "css",
            value: "input[name='memberId']",
            robustness: "Form field name is server-owned and stable for postback."
          }
        ]
      },
      value: { template: "{{memberId}}", sensitive: false }
    },
    {
      id: "submit-search",
      description: "Submit the search form.",
      action: "click",
      riskLevel: "safe",
      target: {
        primary: {
          kind: "text",
          value: "Search",
          robustness: "Visible button label is the operator-facing control identity."
        },
        fallbacks: [
          {
            kind: "css",
            value: "button[type='submit']",
            robustness: "Fallback to form submit button when accessible text is unavailable."
          }
        ]
      },
      expected: [
        {
          type: "text_visible",
          description: "Either search results or a known outcome is visible.",
          value: "Member Number",
          timeoutMs: 5_000
        }
      ],
      onError: [
        {
          code: "invalid_member_number",
          outcomeType: "business_outcome",
          description: "The app rejected the member number format.",
          detector: {
            type: "text_visible",
            description: "Validation error is displayed.",
            value: "Validation error",
            timeoutMs: 1_000
          }
        },
        {
          code: "member_not_found",
          outcomeType: "business_outcome",
          description: "The searched member number does not exist.",
          detector: {
            type: "text_visible",
            description: "No member record message is displayed.",
            value: "No member record found",
            timeoutMs: 1_000
          }
        }
      ]
    },
    {
      id: "open-member-detail",
      description: "Open the matching member detail page.",
      action: "click",
      riskLevel: "safe",
      target: {
        primary: {
          kind: "text",
          value: "Open Member Detail",
          robustness: "Uses visible operator action text rather than generated markup."
        },
        fallbacks: [
          {
            kind: "css",
            value: "a[href^='/members/']",
            robustness: "Fallback matches server route pattern for member detail links."
          }
        ]
      },
      expected: [
        {
          type: "text_visible",
          description: "Member detail page is visible.",
          value: "Member Detail",
          timeoutMs: 5_000
        }
      ],
      onError: [
        {
          code: "restricted_member_requires_review",
          outcomeType: "requires_human",
          description: "A restricted member dialog requires human review before automation continues.",
          detector: {
            type: "text_visible",
            description: "Supervisor review dialog is displayed.",
            value: "Supervisor review required",
            timeoutMs: 1_000
          },
          recovery: { action: "handoff", notes: "Pause the same browser session and let an operator review the dialog." }
        }
      ]
    },
    {
      id: "read-member-name",
      description: "Extract the member name from the profile summary table.",
      action: "read",
      riskLevel: "safe",
      extract: [
        {
          outputKey: "memberName",
          source: "text",
          target: {
            primary: {
              kind: "xpath",
              value: "//th[normalize-space()='Member Name']/following-sibling::td[1]",
              robustness: "Anchors extraction to the visible table header instead of row position alone."
            },
            fallbacks: []
          },
          required: true
        }
      ]
    },
    {
      id: "read-savings-balance",
      description: "Extract the current savings balance from the deposit account balances table.",
      action: "read",
      riskLevel: "safe",
      extract: [
        {
          outputKey: "savingsBalance",
          source: "text",
          target: {
            primary: {
              kind: "xpath",
              value: "//td[normalize-space()='Savings']/following-sibling::td[1]",
              robustness: "Anchors extraction to the visible Savings account row and reads the current balance cell."
            },
            fallbacks: []
          },
          pattern: "^\\$[0-9,]+\\.[0-9]{2}$",
          required: true
        }
      ]
    }
  ],
  successCondition: {
    type: "text_visible",
    description: "Deposit account balances are visible and declared outputs were extracted.",
    value: "Checkpoint: deposit account balances visible.",
    timeoutMs: 5_000
  },
  businessOutcomes: [
    {
      code: "member_not_found",
      outcomeType: "business_outcome",
      description: "No member exists for the supplied member number.",
      detector: {
        type: "text_visible",
        description: "No member record message is displayed.",
        value: "No member record found",
        timeoutMs: 1_000
      }
    },
    {
      code: "invalid_member_number",
      outcomeType: "business_outcome",
      description: "The supplied member number failed application validation.",
      detector: {
        type: "text_visible",
        description: "Validation error message is displayed.",
        value: "Validation error",
        timeoutMs: 1_000
      }
    }
  ],
  notes: "This seed artifact is human-authored to lock the replay contract before the LLM discovery milestone emits the same shape."
};
