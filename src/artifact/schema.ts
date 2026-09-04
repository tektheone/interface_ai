import { z } from "zod";

export const ArtifactSchemaVersion = "1.0.0";

export const PrimitiveValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type PrimitiveValue = z.infer<typeof PrimitiveValueSchema>;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    PrimitiveValueSchema,
    z.array(JsonValueSchema),
    z.record(JsonValueSchema)
  ])
);
export type JsonValue = PrimitiveValue | JsonValue[] | { [key: string]: JsonValue };

export const ValueTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "currency",
  "date",
  "object",
  "array"
]);
export type ValueType = z.infer<typeof ValueTypeSchema>;

export const SurfaceTypeSchema = z.enum(["web", "legacy_web", "desktop", "terminal"]);
export type SurfaceType = z.infer<typeof SurfaceTypeSchema>;

export const LocatorKindSchema = z.enum([
  "role",
  "label",
  "text",
  "css",
  "xpath",
  "accessibility",
  "coordinates"
]);
export type LocatorKind = z.infer<typeof LocatorKindSchema>;

export const ActionTypeSchema = z.enum([
  "navigate",
  "click",
  "type",
  "read",
  "wait_for",
  "assert",
  "select",
  "handoff"
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const RiskLevelSchema = z.enum(["safe", "reversible", "risky", "irreversible"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const OutcomeTypeSchema = z.enum([
  "success",
  "business_outcome",
  "recoverable",
  "requires_human",
  "failure"
]);
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>;

export const ParameterSchema = z.object({
  type: ValueTypeSchema,
  description: z.string(),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  redaction: z.enum(["none", "partial", "full"]).default("none"),
  example: JsonValueSchema.optional()
});
export type Parameter = z.infer<typeof ParameterSchema>;

export const OutputSchema = z.object({
  type: ValueTypeSchema,
  description: z.string(),
  sensitive: z.boolean().default(false),
  redaction: z.enum(["none", "partial", "full"]).default("partial"),
  nullable: z.boolean().default(false)
});
export type Output = z.infer<typeof OutputSchema>;

export const LocatorSchema = z.object({
  kind: LocatorKindSchema,
  value: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  robustness: z.string(),
  frame: z.string().optional()
});
export type Locator = z.infer<typeof LocatorSchema>;

export const TargetSchema = z.object({
  primary: LocatorSchema,
  fallbacks: z.array(LocatorSchema).default([])
});
export type Target = z.infer<typeof TargetSchema>;

export const StepValueSchema = z.object({
  template: z.string(),
  sensitive: z.boolean().default(false)
});
export type StepValue = z.infer<typeof StepValueSchema>;

export const ExtractionSchema = z.object({
  outputKey: z.string(),
  source: z.enum(["text", "attribute", "value", "url"]),
  target: TargetSchema.optional(),
  attribute: z.string().optional(),
  pattern: z.string().optional(),
  required: z.boolean().default(true)
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const ConditionSchema = z.object({
  type: z.enum(["url_contains", "text_visible", "element_visible", "element_hidden", "output_present"]),
  description: z.string(),
  target: TargetSchema.optional(),
  value: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5_000)
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ErrorMappingSchema = z.object({
  code: z.string(),
  outcomeType: OutcomeTypeSchema.exclude(["success"]),
  description: z.string(),
  detector: ConditionSchema,
  recovery: z
    .object({
      action: z.enum(["retry", "dismiss", "handoff", "stop"]),
      maxAttempts: z.number().int().positive().optional(),
      notes: z.string().optional()
    })
    .optional()
});
export type ErrorMapping = z.infer<typeof ErrorMappingSchema>;

export const CapabilityStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  action: ActionTypeSchema,
  riskLevel: RiskLevelSchema.default("safe"),
  target: TargetSchema.optional(),
  value: StepValueSchema.optional(),
  waitAfterMs: z.number().int().nonnegative().default(0),
  expected: z.array(ConditionSchema).default([]),
  extract: z.array(ExtractionSchema).default([]),
  onError: z.array(ErrorMappingSchema).default([])
});
export type CapabilityStep = z.infer<typeof CapabilityStepSchema>;

export const GuardrailPolicySchema = z.object({
  allowedOrigins: z.array(z.string().url()),
  allowedRoutes: z.array(z.string()),
  allowedActions: z.array(ActionTypeSchema),
  blockedRiskLevels: z.array(RiskLevelSchema).default(["irreversible"]),
  requireHumanForRiskLevels: z.array(RiskLevelSchema).default(["risky", "irreversible"]),
  redactInputKeys: z.array(z.string()).default([]),
  redactOutputKeys: z.array(z.string()).default([])
});
export type GuardrailPolicy = z.infer<typeof GuardrailPolicySchema>;

export const CapabilityArtifactSchema = z.object({
  schemaVersion: z.literal(ArtifactSchemaVersion),
  capability: z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
    createdAt: z.string().datetime(),
    source: z.enum(["llm_discovery", "human_authored", "hybrid"]),
    reviewStatus: z.enum(["draft", "approved", "deprecated"]).default("draft")
  }),
  targetApp: z.object({
    name: z.string(),
    vendor: z.string(),
    surface: SurfaceTypeSchema,
    baseUrl: z.string().url().optional(),
    version: z.string(),
    tenantScope: z.enum(["global", "vendor_version", "tenant_override"]).default("vendor_version")
  }),
  inputs: z.record(ParameterSchema),
  outputs: z.record(OutputSchema),
  policy: GuardrailPolicySchema,
  steps: z.array(CapabilityStepSchema).min(1),
  successCondition: ConditionSchema,
  businessOutcomes: z.array(ErrorMappingSchema).default([]),
  notes: z.string().optional()
});
export type CapabilityArtifactInput = z.input<typeof CapabilityArtifactSchema>;
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;

export function parseCapabilityArtifact(value: unknown): CapabilityArtifact {
  return CapabilityArtifactSchema.parse(value);
}
