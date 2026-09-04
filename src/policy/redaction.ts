import type { CapabilityArtifact, JsonValue, Output, Parameter } from "../artifact/schema.js";

export type RedactionMode = "none" | "partial" | "full";

const secretPatterns = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;}]+/gi
];

export function redactInputs(artifact: CapabilityArtifact, inputs: Record<string, JsonValue>): Record<string, JsonValue> {
  return redactRecord(inputs, artifact.inputs, artifact.policy.redactInputKeys);
}

export function redactOutputs(artifact: CapabilityArtifact, outputs: Record<string, JsonValue>): Record<string, JsonValue> {
  return redactRecord(outputs, artifact.outputs, artifact.policy.redactOutputKeys);
}

export function redactJson(value: JsonValue, sensitiveKeys: string[] = []): JsonValue {
  if (typeof value === "string") {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, sensitiveKeys));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKeys.includes(key) ? "[REDACTED]" : redactJson(nestedValue, sensitiveKeys)
      ])
    );
  }

  return value;
}

export function redactText(value: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

export function redactValue(value: JsonValue, mode: RedactionMode): JsonValue {
  if (mode === "none") {
    return typeof value === "string" ? redactText(value) : redactJson(value);
  }

  if (mode === "full") {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return partiallyRedactString(redactText(value));
  }

  if (typeof value === "number") {
    return "[REDACTED_NUMBER]";
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  return redactJson(value);
}

function redactRecord<TDefinition extends Parameter | Output>(
  values: Record<string, JsonValue>,
  definitions: Record<string, TDefinition>,
  forcedKeys: string[]
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const definition = definitions[key];
      const mode = forcedKeys.includes(key) ? "full" : definition?.redaction ?? "none";
      return [key, redactValue(value, mode)];
    })
  );
}

function partiallyRedactString(value: string): string {
  if (value.length <= 4) {
    return "[REDACTED]";
  }

  const prefix = value.slice(0, 2);
  const suffix = value.slice(-2);
  return `${prefix}${"*".repeat(Math.min(value.length - 4, 8))}${suffix}`;
}
