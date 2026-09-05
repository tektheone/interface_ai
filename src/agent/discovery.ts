import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { CapabilityArtifactSchema, type CapabilityArtifact, type CapabilityStep, type JsonValue } from "../artifact/schema.js";
import { lookupMemberSavingsBalanceArtifact } from "../artifact/example-artifact.js";
import { createEvidenceLogger, redactRunInputs, redactRunOutputs } from "../evidence/index.js";
import { evaluateActionPolicy, evaluateNavigationPolicy } from "../policy/index.js";
import { resolveVisibleTarget } from "../replay/locator.js";
import { createMockDecider, createOpenAIDecider, type DiscoveryAction, type DiscoveryDecider } from "./openai-client.js";
import { observePage } from "./observations.js";

export type DiscoveryOptions = {
  goal: string;
  memberId: string;
  baseUrl: string;
  artifactPath: string;
  evidenceDir?: string;
  model: string;
  apiKey?: string;
  mock?: boolean;
  headed?: boolean;
  maxSteps?: number;
};

export type DiscoveryResult = {
  status: "success" | "failure";
  artifactPath?: string;
  outputs: Record<string, JsonValue>;
  steps: CapabilityStep[];
  evidenceDir: string;
  message: string;
};

export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const artifact = buildDiscoveryArtifact(options.baseUrl, options.mock ?? false);
  const logger = await createEvidenceLogger({
    mode: "discovery",
    capabilityName: artifact.capability.name,
    baseDir: options.evidenceDir
  });
  const decider = options.mock ? createMockDecider(options.memberId) : createOpenAIDecider({ apiKey: options.apiKey, model: options.model });
  const outputs: Record<string, JsonValue> = {};
  const recordedSteps: CapabilityStep[] = [];
  let browser: Browser | undefined;

  logger.writeEvent({
    event: "discovery_goal",
    message: options.goal,
    data: redactRunInputs(artifact, { memberId: options.memberId })
  });

  try {
    browser = await chromium.launch({ headless: !options.headed });
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    await page.goto(options.baseUrl, { waitUntil: "domcontentloaded" });

    for (let stepNumber = 1; stepNumber <= (options.maxSteps ?? 10); stepNumber += 1) {
      const observation = await observePage(page);
      logger.writeEvent({ event: "observation", message: `Observation before discovery step ${stepNumber}.`, data: redactedObservationForEvidence(observation) });

      const action = await decider.decide({
        goal: options.goal,
        observation,
        stepNumber,
        outputs: stringOutputs(outputs),
        allowedBaseUrl: options.baseUrl,
        allowedRoutes: artifact.policy.allowedRoutes
      });
      logger.writeEvent({ event: "llm_decision", message: action.rationale, data: action as unknown as JsonValue });

      if (action.action === "done") {
        if (!outputs.memberName || !outputs.savingsBalance) {
          return { status: "failure", outputs, steps: recordedSteps, evidenceDir: logger.runDir, message: "Model stopped before required outputs were extracted." };
        }

        await persistDiscoveredArtifact(options.artifactPath, artifact);
        await logger.writeArtifact(artifact, "discovered-artifact.json");
        const screenshotRef = await logger.writeBuffer("screenshot", "discovery-final-screenshot.png", await page.screenshot({ fullPage: true }), "Final browser state after successful discovery.");
        logger.writeEvent({ event: "run_completed", status: "success", message: "Discovery completed and artifact was saved.", data: redactRunOutputs(artifact, outputs), evidence: [screenshotRef] });
        return { status: "success", artifactPath: options.artifactPath, outputs, steps: recordedSteps, evidenceDir: logger.runDir, message: "Discovery completed." };
      }

      const policyFailure = validateDiscoveryAction(artifact, action);
      if (policyFailure) {
        return { status: "failure", outputs, steps: recordedSteps, evidenceDir: logger.runDir, message: policyFailure };
      }

      const recordedStep = await executeDiscoveryAction(page, action, options.baseUrl, outputs, stepNumber);
      recordedSteps.push(recordedStep);
      logger.writeEvent({ event: "action_executed", stepId: recordedStep.id, message: recordedStep.description, data: redactRunOutputs(artifact, outputs) });
    }

    return { status: "failure", outputs, steps: recordedSteps, evidenceDir: logger.runDir, message: "Discovery hit max steps before completion." };
  } catch (error) {
    logger.writeEvent({ event: "run_completed", status: "failure", message: errorMessage(error) });
    return { status: "failure", outputs, steps: recordedSteps, evidenceDir: logger.runDir, message: errorMessage(error) };
  } finally {
    if (browser) {
      await browser.close();
    }
    await logger.close();
  }
}

function buildDiscoveryArtifact(baseUrl: string, mock: boolean): CapabilityArtifact {
  const origin = new URL(baseUrl).origin;
  return CapabilityArtifactSchema.parse({
    ...lookupMemberSavingsBalanceArtifact,
    capability: {
      ...lookupMemberSavingsBalanceArtifact.capability,
      createdAt: new Date().toISOString(),
      source: mock ? "hybrid" : "llm_discovery"
    },
    targetApp: {
      ...lookupMemberSavingsBalanceArtifact.targetApp,
      baseUrl
    },
    policy: {
      ...lookupMemberSavingsBalanceArtifact.policy,
      allowedOrigins: [origin]
    },
    notes: mock
      ? "Generated through the discovery loop with deterministic mock decisions because OPENAI_API_KEY was unavailable. Replace with a real OpenAI discovery run before final submission."
      : "Generated through the OpenAI-backed discovery loop."
  });
}

function validateDiscoveryAction(artifact: CapabilityArtifact, action: DiscoveryAction): string | undefined {
  if (action.action === "navigate") {
    const decision = evaluateNavigationPolicy(artifact, action.target);
    return decision.allowed ? undefined : decision.reason;
  }

  const decision = evaluateActionPolicy(artifact.policy, action.action === "done" ? "assert" : action.action, "safe");
  return decision.allowed ? undefined : decision.reason;
}

async function executeDiscoveryAction(
  page: Page,
  action: Exclude<DiscoveryAction, { action: "done" }>,
  baseUrl: string,
  outputs: Record<string, JsonValue>,
  stepNumber: number
): Promise<CapabilityStep> {
  switch (action.action) {
    case "navigate":
      await page.goto(new URL(action.target, baseUrl).toString(), { waitUntil: "domcontentloaded" });
      return { id: stepId(stepNumber, "navigate"), description: action.rationale, action: "navigate", riskLevel: "safe", value: { template: action.target, sensitive: false }, waitAfterMs: 0, expected: [], extract: [], onError: [] };
    case "click":
      await (await resolveVisibleTarget(page, { primary: { ...action.target, robustness: "Chosen by LLM from visible browser observation." }, fallbacks: [] }, 5_000)).click({ timeout: 5_000 });
      return { id: stepId(stepNumber, "click"), description: action.rationale, action: "click", riskLevel: "safe", target: { primary: { ...action.target, robustness: "Chosen by LLM from visible browser observation." }, fallbacks: [] }, waitAfterMs: 0, expected: [], extract: [], onError: [] };
    case "type":
      await (await resolveVisibleTarget(page, { primary: { ...action.target, robustness: "Chosen by LLM from visible browser observation." }, fallbacks: [] }, 5_000)).fill(action.value);
      return { id: stepId(stepNumber, "type"), description: action.rationale, action: "type", riskLevel: "safe", target: { primary: { ...action.target, robustness: "Chosen by LLM from visible browser observation." }, fallbacks: [] }, value: { template: "{{memberId}}", sensitive: false }, waitAfterMs: 0, expected: [], extract: [], onError: [] };
    case "read": {
      const target = { primary: { ...action.target, robustness: "Chosen by LLM to extract the declared output." }, fallbacks: [] };
      const value = (await (await resolveVisibleTarget(page, target, 5_000)).textContent())?.trim() ?? "";
      outputs[action.outputKey] = value;
      return { id: stepId(stepNumber, `read-${action.outputKey}`), description: action.rationale, action: "read", riskLevel: "safe", waitAfterMs: 0, extract: [{ outputKey: action.outputKey, source: "text", target, required: true }], expected: [], onError: [] };
    }
  }
}

async function persistDiscoveredArtifact(artifactPath: string, artifact: CapabilityArtifact): Promise<void> {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function stepId(stepNumber: number, action: string): string {
  return `${String(stepNumber).padStart(2, "0")}-${action.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}

function stringOutputs(outputs: Record<string, JsonValue>): Record<string, string> {
  return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, String(value)]));
}

function redactedObservationForEvidence(observation: Awaited<ReturnType<typeof observePage>>): JsonValue {
  return {
    url: observation.url,
    title: observation.title,
    visibleTextLength: observation.visibleText.length,
    controls: observation.controls
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
