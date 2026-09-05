import { chromium, type Browser, type Page } from "@playwright/test";
import type { CapabilityArtifact, CapabilityStep, Condition, ErrorMapping, Extraction, JsonValue } from "../artifact/schema.js";
import type { EvidenceLogger } from "../evidence/index.js";
import { createEvidenceLogger, redactRunInputs, redactRunOutputs } from "../evidence/index.js";
import { evaluateStepPolicy } from "../policy/index.js";
import type { EvidenceRef, RunResult, StepObservation, StepResult } from "./result.js";
import { resolveTarget, resolveVisibleTarget } from "./locator.js";

export type ReplayOptions = {
  artifact: CapabilityArtifact;
  inputs: Record<string, JsonValue>;
  baseUrl?: string;
  headed?: boolean;
  evidenceDir?: string;
  runId?: string;
  keepBrowserOpen?: boolean;
  stepTimeoutMs?: number;
};

export async function replayCapability(options: ReplayOptions): Promise<RunResult> {
  const startedAt = new Date();
  const logger = await createEvidenceLogger({
    mode: "replay",
    capabilityName: options.artifact.capability.name,
    baseDir: options.evidenceDir,
    runId: options.runId,
    startedAt
  });
  const steps: StepResult[] = [];
  const outputs: Record<string, JsonValue> = {};
  let browser: Browser | undefined;

  logger.writeEvent({
    event: "replay_inputs",
    message: "Replay started with redacted inputs.",
    data: redactRunInputs(options.artifact, options.inputs)
  });
  const artifactRef = await logger.writeArtifact(options.artifact);

  try {
    browser = await chromium.launch({ headless: !options.headed });
    const page = await browser.newPage();
    page.setDefaultTimeout(options.stepTimeoutMs ?? 10_000);
    page.setDefaultNavigationTimeout(options.stepTimeoutMs ?? 10_000);
    const baseUrl = options.baseUrl ?? options.artifact.targetApp.baseUrl;

    if (!baseUrl) {
      return await finishFailure(logger, steps, outputs, options.artifact, startedAt, "missing_base_url", "Artifact does not define a base URL.");
    }

    for (const step of options.artifact.steps) {
      const result = await withTimeout(
        executeStep({ step, page, baseUrl, options, logger, outputs }),
        options.stepTimeoutMs ?? 15_000,
        `Step '${step.id}' exceeded replay timeout.`
      );
      steps.push(result);
      logger.writeEvent({
        event: "step_completed",
        stepId: step.id,
        status: result.status,
        message: result.message,
        data: redactRunOutputs(options.artifact, result.outputs),
        evidence: result.evidence
      });

      if (result.status === "business_outcome") {
        return finishBusinessOutcome(logger, steps, outputs, options.artifact, startedAt, result.errorCode ?? "business_outcome", result.message, [artifactRef]);
      }

      if (result.status === "requires_human") {
        const requestRef = await writeInterventionRequest(logger, options.artifact, step, result, outputs);
        return finishRequiresHuman(logger, steps, outputs, options.artifact, startedAt, result.errorCode ?? "requires_human", result.message, step.id, requestRef.path, [artifactRef, requestRef]);
      }

      if (result.status === "failure") {
        const refs = await captureFailureEvidence(logger, page, step.id);
        return finishFailure(logger, steps, outputs, options.artifact, startedAt, result.errorCode ?? "step_failed", result.message, step.id, undefined, undefined, [artifactRef, ...refs]);
      }
    }

    const success = await conditionMet(page, options.artifact.successCondition, outputs);
    if (!success) {
      const refs = await captureFailureEvidence(logger, page, "success-condition");
      return finishFailure(logger, steps, outputs, options.artifact, startedAt, "success_condition_not_met", options.artifact.successCondition.description, undefined, options.artifact.successCondition.description, await pageText(page), [artifactRef, ...refs]);
    }

    return finishSuccess(logger, steps, outputs, options.artifact, startedAt, [artifactRef]);
  } catch (error) {
    return finishFailure(logger, steps, outputs, options.artifact, startedAt, "unhandled_replay_error", errorMessage(error), undefined, undefined, undefined, [artifactRef]);
  } finally {
    if (browser && !options.keepBrowserOpen) {
      await browser.close();
    }
    await logger.close();
  }
}

async function executeStep(context: {
  step: CapabilityStep;
  page: Page;
  baseUrl: string;
  options: ReplayOptions;
  logger: EvidenceLogger;
  outputs: Record<string, JsonValue>;
}): Promise<StepResult> {
  const { step, page, baseUrl, options, outputs } = context;
  const startedAt = new Date();
  const policyDecision = evaluateStepPolicy(options.artifact, step);

  if (!policyDecision.allowed) {
    return buildStepResult(step, "failure", startedAt, policyDecision.reason, outputs, policyDecision.code, await observe(page));
  }

  if (policyDecision.requiresHuman) {
    return buildStepResult(step, "requires_human", startedAt, policyDecision.reason, outputs, "policy_requires_human", await observe(page));
  }

  try {
    await performAction(page, step, baseUrl, options.inputs, outputs);

    if (step.waitAfterMs > 0) {
      await page.waitForTimeout(step.waitAfterMs);
    }

    const mappedOutcome = await detectMappedOutcome(page, step.onError, outputs);
    if (mappedOutcome) {
      return buildStepResult(step, mappedOutcome.outcomeType, startedAt, mappedOutcome.description, outputs, mappedOutcome.code, await observe(page));
    }

    for (const condition of step.expected) {
      if (!(await conditionMet(page, condition, outputs))) {
        return buildStepResult(step, "failure", startedAt, `Expected condition not met: ${condition.description}`, outputs, "expected_condition_not_met", await observe(page));
      }
    }

    for (const extraction of step.extract) {
      await extractOutput(page, extraction, outputs);
    }

    return buildStepResult(step, "success", startedAt, `Step '${step.id}' completed.`, outputs, undefined, await observe(page));
  } catch (error) {
    return buildStepResult(step, "failure", startedAt, errorMessage(error), outputs, "step_execution_error", await observe(page));
  }
}

async function performAction(
  page: Page,
  step: CapabilityStep,
  baseUrl: string,
  inputs: Record<string, JsonValue>,
  outputs: Record<string, JsonValue>
): Promise<void> {
  const value = renderTemplate(step.value?.template ?? "", inputs, outputs);

  switch (step.action) {
    case "navigate":
      await page.goto(new URL(value, baseUrl).toString(), { waitUntil: "domcontentloaded" });
      return;
    case "click":
      if (!step.target) {
        throw new Error(`Step '${step.id}' is missing a target.`);
      }
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined),
        (await resolveVisibleTarget(page, step.target, 5_000)).click({ timeout: 5_000 })
      ]);
      return;
    case "type":
      if (!step.target) {
        throw new Error(`Step '${step.id}' is missing a target.`);
      }
      await (await resolveVisibleTarget(page, step.target, 5_000)).fill(value);
      return;
    case "read":
      return;
    case "wait_for":
    case "assert":
      return;
    case "select":
      if (!step.target) {
        throw new Error(`Step '${step.id}' is missing a target.`);
      }
      await resolveTarget(page, step.target).selectOption(value);
      return;
    case "handoff":
      throw new Error("Handoff execution is handled by the handoff milestone.");
  }
}

async function extractOutput(page: Page, extraction: Extraction, outputs: Record<string, JsonValue>): Promise<void> {
  let rawValue = "";

  if (extraction.source === "url") {
    rawValue = page.url();
  } else {
    if (!extraction.target) {
      throw new Error(`Extraction '${extraction.outputKey}' is missing a target.`);
    }

    const locator = await resolveVisibleTarget(page, extraction.target, 5_000);
    if (extraction.source === "attribute") {
      if (!extraction.attribute) {
        throw new Error(`Extraction '${extraction.outputKey}' is missing an attribute.`);
      }
      rawValue = (await locator.getAttribute(extraction.attribute)) ?? "";
    } else if (extraction.source === "value") {
      rawValue = await locator.inputValue();
    } else {
      rawValue = (await locator.textContent())?.trim() ?? "";
    }
  }

  if (extraction.required && rawValue.length === 0) {
    throw new Error(`Required extraction '${extraction.outputKey}' was empty.`);
  }

  if (extraction.pattern && rawValue.length > 0 && !new RegExp(extraction.pattern).test(rawValue)) {
    throw new Error(`Extraction '${extraction.outputKey}' did not match expected pattern.`);
  }

  outputs[extraction.outputKey] = rawValue;
}

async function detectMappedOutcome(
  page: Page,
  mappings: ErrorMapping[],
  outputs: Record<string, JsonValue>
): Promise<ErrorMapping | undefined> {
  for (const mapping of mappings) {
    if (await conditionMet(page, mapping.detector, outputs, true)) {
      return mapping;
    }
  }
  return undefined;
}

async function conditionMet(
  page: Page,
  condition: Condition,
  outputs: Record<string, JsonValue>,
  quiet = false
): Promise<boolean> {
  try {
    switch (condition.type) {
      case "url_contains":
        return page.url().includes(condition.value ?? "");
      case "text_visible":
        await page.getByText(condition.value ?? "", { exact: false }).first().waitFor({ state: "visible", timeout: condition.timeoutMs });
        return true;
      case "element_visible":
        if (!condition.target) return false;
        await resolveVisibleTarget(page, condition.target, condition.timeoutMs);
        return true;
      case "element_hidden":
        if (!condition.target) return false;
        await resolveTarget(page, condition.target).first().waitFor({ state: "hidden", timeout: condition.timeoutMs });
        return true;
      case "output_present":
        return Boolean(condition.value && outputs[condition.value]);
    }
  } catch (error) {
    if (!quiet) {
      return false;
    }
  }
  return false;
}

function renderTemplate(template: string, inputs: Record<string, JsonValue>, outputs: Record<string, JsonValue>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
    const value = inputs[key] ?? outputs[key];
    if (value === undefined || value === null) {
      throw new Error(`No value supplied for template variable '${key}'.`);
    }
    return String(value);
  });
}

async function captureFailureEvidence(logger: EvidenceLogger, page: Page, stepId: string): Promise<EvidenceRef[]> {
  const screenshot = await logger.writeBuffer("screenshot", `${stepId}-screenshot.png`, await page.screenshot({ fullPage: true }), `Screenshot captured for '${stepId}'.`);
  const dom = await logger.writeText("dom_snapshot", `${stepId}-dom.html`, await page.content(), `DOM snapshot captured for '${stepId}'.`);
  return [screenshot, dom];
}

async function writeInterventionRequest(
  logger: EvidenceLogger,
  artifact: CapabilityArtifact,
  step: CapabilityStep,
  result: StepResult,
  outputs: Record<string, JsonValue>
): Promise<EvidenceRef> {
  return logger.writeJson(
    "intervention_request",
    `${step.id}-intervention-request.json`,
    {
      capability: artifact.capability.name,
      stepId: step.id,
      reason: result.message,
      observed: result.observed ?? null,
      outputs: redactRunOutputs(artifact, outputs)
    },
    `Human intervention request for '${step.id}'.`
  );
}

async function observe(page: Page): Promise<StepObservation> {
  return {
    url: page.url(),
    title: await page.title().catch(() => undefined),
    visibleText: await pageText(page).catch(() => undefined),
    evidence: []
  };
}

async function pageText(page: Page): Promise<string> {
  const text = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
  return text.slice(0, 2_000);
}

function buildStepResult(
  step: CapabilityStep,
  status: StepResult["status"],
  startedAt: Date,
  message: string,
  outputs: Record<string, JsonValue>,
  errorCode?: string,
  observed?: StepObservation
): StepResult {
  return {
    stepId: step.id,
    status,
    action: step.action,
    message,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    attempts: 1,
    observed,
    outputs: { ...outputs },
    errorCode,
    evidence: []
  };
}

async function finishSuccess(
  logger: EvidenceLogger,
  steps: StepResult[],
  outputs: Record<string, JsonValue>,
  artifact: CapabilityArtifact,
  startedAt: Date,
  evidence: EvidenceRef[]
): Promise<RunResult> {
  const redactedOutputs = redactRunOutputs(artifact, outputs);
  logger.writeEvent({ event: "run_completed", status: "success", message: "Replay completed successfully.", data: redactedOutputs, evidence });
  return {
    status: "success",
    runId: logger.runId,
    mode: "replay",
    capabilityName: artifact.capability.name,
    capabilityVersion: artifact.capability.version,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    steps,
    evidence: [logger.logRef, ...evidence],
    outputs
  };
}

function finishBusinessOutcome(
  logger: EvidenceLogger,
  steps: StepResult[],
  outputs: Record<string, JsonValue>,
  artifact: CapabilityArtifact,
  startedAt: Date,
  code: string,
  message: string,
  evidence: EvidenceRef[]
): RunResult {
  logger.writeEvent({ event: "run_completed", status: "business_outcome", message, data: { code }, evidence });
  return baseTerminalResult(logger, steps, outputs, artifact, startedAt, evidence, { status: "business_outcome", code, message });
}

function finishRequiresHuman(
  logger: EvidenceLogger,
  steps: StepResult[],
  outputs: Record<string, JsonValue>,
  artifact: CapabilityArtifact,
  startedAt: Date,
  code: string,
  message: string,
  stepId: string,
  interventionRequestPath: string,
  evidence: EvidenceRef[]
): RunResult {
  logger.writeEvent({ event: "run_completed", status: "requires_human", message, data: { code, interventionRequestPath }, evidence });
  return baseTerminalResult(logger, steps, outputs, artifact, startedAt, evidence, { status: "requires_human", code, message, stepId, interventionRequestPath });
}

async function finishFailure(
  logger: EvidenceLogger,
  steps: StepResult[],
  outputs: Record<string, JsonValue>,
  artifact: CapabilityArtifact,
  startedAt: Date,
  code: string,
  message: string,
  stepId?: string,
  expected?: string,
  observed?: string,
  evidence: EvidenceRef[] = []
): Promise<RunResult> {
  logger.writeEvent({ event: "run_completed", status: "failure", message, data: compactJson({ code, stepId, expected, observed }), evidence });
  return baseTerminalResult(logger, steps, outputs, artifact, startedAt, evidence, { status: "failure", code, message, stepId, expected, observed });
}

function baseTerminalResult<T extends { status: Exclude<RunResult["status"], "success"> }>(
  logger: EvidenceLogger,
  steps: StepResult[],
  outputs: Record<string, JsonValue>,
  artifact: CapabilityArtifact,
  startedAt: Date,
  evidence: EvidenceRef[],
  terminal: T
): RunResult {
  return {
    ...terminal,
    runId: logger.runId,
    mode: "replay",
    capabilityName: artifact.capability.name,
    capabilityVersion: artifact.capability.version,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    steps,
    evidence: [logger.logRef, ...evidence],
    outputs
  } as unknown as RunResult;
}

function compactJson(value: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
