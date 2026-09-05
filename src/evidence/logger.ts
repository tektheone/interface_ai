import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWriteStream, type WriteStream } from "node:fs";
import type { CapabilityArtifact, JsonValue } from "../artifact/schema.js";
import type { EvidenceRef, RunMode, RunStatus } from "../replay/result.js";
import { redactInputs, redactJson, redactOutputs } from "../policy/redaction.js";

export type EvidenceLoggerOptions = {
  mode: RunMode;
  capabilityName: string;
  baseDir?: string;
  runId?: string;
  startedAt?: Date;
};

export type EvidenceEvent = {
  timestamp?: string;
  runId?: string;
  mode?: RunMode;
  event: string;
  stepId?: string;
  status?: RunStatus;
  message?: string;
  data?: JsonValue;
  evidence?: EvidenceRef[];
};

export type EvidenceLogger = {
  runId: string;
  runDir: string;
  logPath: string;
  logRef: EvidenceRef;
  writeEvent(event: EvidenceEvent): void;
  writeArtifact(artifact: CapabilityArtifact, filename?: string): Promise<EvidenceRef>;
  writeJson(kind: EvidenceRef["kind"], filename: string, value: JsonValue, description?: string): Promise<EvidenceRef>;
  writeText(kind: EvidenceRef["kind"], filename: string, value: string, description?: string): Promise<EvidenceRef>;
  writeBuffer(kind: EvidenceRef["kind"], filename: string, value: Buffer, description?: string): Promise<EvidenceRef>;
  close(): Promise<void>;
};

export async function createEvidenceLogger(options: EvidenceLoggerOptions): Promise<EvidenceLogger> {
  const startedAt = options.startedAt ?? new Date();
  const runId = options.runId ?? createRunId(options.mode, options.capabilityName, startedAt);
  const baseDir = options.baseDir ?? "evidence";
  const runDir = path.join(baseDir, runId);
  const logPath = path.join(runDir, "events.jsonl");

  await mkdir(runDir, { recursive: true });

  const stream = createWriteStream(logPath, { flags: "a" });
  const logRef = makeEvidenceRef("log", logPath, "Structured JSONL evidence log for this run.");

  const logger: EvidenceLogger = {
    runId,
    runDir,
    logPath,
    logRef,
    writeEvent(event) {
      const entry = redactJson({
        timestamp: event.timestamp ?? new Date().toISOString(),
        runId,
        mode: options.mode,
        ...event
      });

      stream.write(`${JSON.stringify(entry)}\n`);
    },
    async writeArtifact(artifact, filename = "artifact.json") {
      return logger.writeJson("artifact", filename, artifact as unknown as JsonValue, "Capability artifact saved for this run.");
    },
    async writeJson(kind, filename, value, description) {
      const filePath = path.join(runDir, safeFilename(filename));
      await writeFile(filePath, `${JSON.stringify(redactJson(value), null, 2)}\n`, "utf8");
      return makeEvidenceRef(kind, filePath, description);
    },
    async writeText(kind, filename, value, description) {
      const filePath = path.join(runDir, safeFilename(filename));
      await writeFile(filePath, String(redactJson(value)), "utf8");
      return makeEvidenceRef(kind, filePath, description);
    },
    async writeBuffer(kind, filename, value, description) {
      const filePath = path.join(runDir, safeFilename(filename));
      await writeFile(filePath, value);
      return makeEvidenceRef(kind, filePath, description);
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        stream.end((error: Error | null | undefined) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };

  logger.writeEvent({ event: "run_started", message: `${options.mode} run started.` });
  return logger;
}

export function redactRunInputs(artifact: CapabilityArtifact, inputs: Record<string, JsonValue>): Record<string, JsonValue> {
  return redactInputs(artifact, inputs);
}

export function redactRunOutputs(artifact: CapabilityArtifact, outputs: Record<string, JsonValue>): Record<string, JsonValue> {
  return redactOutputs(artifact, outputs);
}

export function createRunId(mode: RunMode, capabilityName: string, date = new Date()): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `${timestamp}-${mode}-${slugify(capabilityName)}`;
}

export function makeEvidenceRef(kind: EvidenceRef["kind"], filePath: string, description?: string): EvidenceRef {
  return { kind, path: normalizeEvidencePath(filePath), description };
}

export function normalizeEvidencePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function safeFilename(filename: string): string {
  const parsed = path.parse(filename);
  const basename = slugify(parsed.name) || "evidence";
  const extension = parsed.ext.replace(/[^.a-zA-Z0-9_-]/g, "");
  return `${basename}${extension}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
