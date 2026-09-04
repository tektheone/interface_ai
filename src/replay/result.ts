import { z } from "zod";
import { JsonValueSchema } from "../artifact/schema.js";

export const RunModeSchema = z.enum(["discovery", "replay"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunStatusSchema = z.enum([
  "success",
  "business_outcome",
  "recoverable",
  "requires_human",
  "failure"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const EvidenceRefSchema = z.object({
  kind: z.enum(["log", "screenshot", "trace", "dom_snapshot", "intervention_request", "artifact"]),
  path: z.string(),
  description: z.string().optional()
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const StepObservationSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  visibleText: z.string().optional(),
  evidence: z.array(EvidenceRefSchema).default([])
});
export type StepObservation = z.infer<typeof StepObservationSchema>;

export const StepResultSchema = z.object({
  stepId: z.string(),
  status: RunStatusSchema,
  action: z.string(),
  message: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  attempts: z.number().int().positive().default(1),
  observed: StepObservationSchema.optional(),
  outputs: z.record(JsonValueSchema).default({}),
  errorCode: z.string().optional(),
  evidence: z.array(EvidenceRefSchema).default([])
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const BaseRunResultSchema = z.object({
  runId: z.string(),
  mode: RunModeSchema,
  capabilityName: z.string(),
  capabilityVersion: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  steps: z.array(StepResultSchema),
  evidence: z.array(EvidenceRefSchema).default([])
});

export const SuccessfulRunResultSchema = BaseRunResultSchema.extend({
  status: z.literal("success"),
  outputs: z.record(JsonValueSchema)
});
export type SuccessfulRunResult = z.infer<typeof SuccessfulRunResultSchema>;

export const BusinessOutcomeRunResultSchema = BaseRunResultSchema.extend({
  status: z.literal("business_outcome"),
  code: z.string(),
  message: z.string(),
  outputs: z.record(JsonValueSchema).default({})
});
export type BusinessOutcomeRunResult = z.infer<typeof BusinessOutcomeRunResultSchema>;

export const RecoverableRunResultSchema = BaseRunResultSchema.extend({
  status: z.literal("recoverable"),
  code: z.string(),
  message: z.string(),
  recoveredAtStepId: z.string(),
  outputs: z.record(JsonValueSchema).default({})
});
export type RecoverableRunResult = z.infer<typeof RecoverableRunResultSchema>;

export const RequiresHumanRunResultSchema = BaseRunResultSchema.extend({
  status: z.literal("requires_human"),
  code: z.string(),
  message: z.string(),
  stepId: z.string(),
  interventionRequestPath: z.string(),
  outputs: z.record(JsonValueSchema).default({})
});
export type RequiresHumanRunResult = z.infer<typeof RequiresHumanRunResultSchema>;

export const FailedRunResultSchema = BaseRunResultSchema.extend({
  status: z.literal("failure"),
  code: z.string(),
  message: z.string(),
  stepId: z.string().optional(),
  expected: z.string().optional(),
  observed: z.string().optional(),
  outputs: z.record(JsonValueSchema).default({})
});
export type FailedRunResult = z.infer<typeof FailedRunResultSchema>;

export const RunResultSchema = z.discriminatedUnion("status", [
  SuccessfulRunResultSchema,
  BusinessOutcomeRunResultSchema,
  RecoverableRunResultSchema,
  RequiresHumanRunResultSchema,
  FailedRunResultSchema
]);
export type RunResult = z.infer<typeof RunResultSchema>;

export function parseRunResult(value: unknown): RunResult {
  return RunResultSchema.parse(value);
}
