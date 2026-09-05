import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Page } from "@playwright/test";
import type { CapabilityArtifact, CapabilityStep, JsonValue } from "../artifact/schema.js";
import type { EvidenceLogger } from "../evidence/index.js";
import { redactRunOutputs } from "../evidence/index.js";
import type { EvidenceRef, StepObservation, StepResult } from "../replay/result.js";

export type HandoffMode = "off" | "prompt" | "auto";

export type HandoffRequest = {
  capability: string;
  stepId: string;
  reason: string;
  controlState: "automation_paused";
  observed: StepObservation | null;
  outputs: Record<string, JsonValue>;
};

export type HandoffResolution = {
  resumed: boolean;
  mode: HandoffMode;
  requestRef: EvidenceRef;
  evidence: EvidenceRef[];
  message: string;
};

export async function handleHumanHandoff(options: {
  mode: HandoffMode;
  page: Page;
  logger: EvidenceLogger;
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  result: StepResult;
  outputs: Record<string, JsonValue>;
}): Promise<HandoffResolution> {
  const { mode, page, logger, artifact, step, result, outputs } = options;
  const requestRef = await writeInterventionRequest(logger, artifact, step, result, outputs);
  const beforeRef = await logger.writeBuffer(
    "screenshot",
    `${step.id}-handoff-before.png`,
    await page.screenshot({ fullPage: true }),
    `Browser state when automation paused for '${step.id}'.`
  );

  logger.writeEvent({
    event: "handoff_requested",
    stepId: step.id,
    status: "requires_human",
    message: result.message,
    evidence: [requestRef, beforeRef]
  });

  if (mode === "off") {
    return {
      resumed: false,
      mode,
      requestRef,
      evidence: [requestRef, beforeRef],
      message: "Automation stopped and returned an intervention request."
    };
  }

  if (mode === "prompt") {
    await waitForOperatorResume(page.url(), requestRef.path);
  } else {
    await autoResolveKnownDemoDialog(page);
  }

  const afterRef = await logger.writeBuffer(
    "screenshot",
    `${step.id}-handoff-after.png`,
    await page.screenshot({ fullPage: true }),
    `Browser state after human control returned for '${step.id}'.`
  );

  logger.writeEvent({
    event: "handoff_resumed",
    stepId: step.id,
    status: "recoverable",
    message: mode === "prompt" ? "Operator signaled resume on the same browser session." : "Auto handoff resolved the demo dialog on the same browser session.",
    evidence: [afterRef]
  });

  return {
    resumed: true,
    mode,
    requestRef,
    evidence: [requestRef, beforeRef, afterRef],
    message: "Human handoff completed; automation resumed."
  };
}

async function writeInterventionRequest(
  logger: EvidenceLogger,
  artifact: CapabilityArtifact,
  step: CapabilityStep,
  result: StepResult,
  outputs: Record<string, JsonValue>
): Promise<EvidenceRef> {
  const request: HandoffRequest = {
    capability: artifact.capability.name,
    stepId: step.id,
    reason: result.message,
    controlState: "automation_paused",
    observed: result.observed ? sanitizeObservation(result.observed) : null,
    outputs: redactRunOutputs(artifact, outputs)
  };

  return logger.writeJson(
    "intervention_request",
    `${step.id}-intervention-request.json`,
    request as unknown as JsonValue,
    `Human intervention request for '${step.id}'.`
  );
}

function sanitizeObservation(observation: StepObservation): StepObservation {
  return {
    url: observation.url,
    title: observation.title,
    visibleText: observation.visibleText ? `[REDACTED_VISIBLE_TEXT length=${observation.visibleText.length}]` : undefined,
    evidence: observation.evidence
  };
}

async function waitForOperatorResume(url: string, requestPath: string): Promise<void> {
  output.write(`\nHuman intervention required.\n`);
  output.write(`Live session URL: ${url}\n`);
  output.write(`Intervention request: ${requestPath}\n`);
  output.write("Use the already-open browser session to complete the manual step.\n");

  const readline = createInterface({ input, output });
  try {
    await readline.question("Press Enter after handing control back to automation...");
  } finally {
    readline.close();
  }
}

async function autoResolveKnownDemoDialog(page: Page): Promise<void> {
  const button = page.getByText("Human reviewed restriction", { exact: true });
  if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await button.click({ timeout: 5_000 });
  }
}
