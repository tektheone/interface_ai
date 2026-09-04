import type { ActionType, CapabilityArtifact, CapabilityStep, GuardrailPolicy, RiskLevel } from "../artifact/schema.js";

export type PolicyDecision =
  | {
      allowed: true;
      requiresHuman: boolean;
      reason: string;
    }
  | {
      allowed: false;
      requiresHuman: boolean;
      reason: string;
      code: PolicyDenialCode;
    };

export type PolicyDenialCode =
  | "action_not_allowed"
  | "risk_blocked"
  | "origin_not_allowed"
  | "route_not_allowed"
  | "invalid_navigation_target";

export function evaluateStepPolicy(artifact: CapabilityArtifact, step: CapabilityStep): PolicyDecision {
  const actionDecision = evaluateActionPolicy(artifact.policy, step.action, step.riskLevel);
  if (!actionDecision.allowed) {
    return actionDecision;
  }

  if (step.action === "navigate") {
    return evaluateNavigationPolicy(artifact, step.value?.template ?? "");
  }

  return actionDecision;
}

export function evaluateActionPolicy(
  policy: GuardrailPolicy,
  action: ActionType,
  riskLevel: RiskLevel
): PolicyDecision {
  if (!policy.allowedActions.includes(action)) {
    return deny("action_not_allowed", `Action '${action}' is not in the policy allowlist.`);
  }

  if (policy.blockedRiskLevels.includes(riskLevel)) {
    return deny("risk_blocked", `Risk level '${riskLevel}' is blocked by policy.`);
  }

  const requiresHuman = policy.requireHumanForRiskLevels.includes(riskLevel);
  return {
    allowed: true,
    requiresHuman,
    reason: requiresHuman
      ? `Risk level '${riskLevel}' requires human approval before execution.`
      : `Action '${action}' with risk level '${riskLevel}' is allowed.`
  };
}

export function evaluateNavigationPolicy(artifact: CapabilityArtifact, target: string): PolicyDecision {
  const baseUrl = artifact.targetApp.baseUrl;
  if (!baseUrl) {
    return deny("invalid_navigation_target", "Artifact target app does not define a base URL for web navigation.");
  }

  const url = resolveUrl(target, baseUrl);
  if (!url) {
    return deny("invalid_navigation_target", `Navigation target '${target}' could not be parsed.`);
  }

  if (!isOriginAllowed(artifact.policy, url)) {
    return deny("origin_not_allowed", `Origin '${url.origin}' is outside the policy allowlist.`);
  }

  if (!isRouteAllowed(artifact.policy, url.pathname)) {
    return deny("route_not_allowed", `Route '${url.pathname}' is outside the policy allowlist.`);
  }

  return { allowed: true, requiresHuman: false, reason: `Navigation to '${url.pathname}' is allowed.` };
}

export function isOriginAllowed(policy: GuardrailPolicy, url: URL): boolean {
  return policy.allowedOrigins.some((allowedOrigin) => new URL(allowedOrigin).origin === url.origin);
}

export function isRouteAllowed(policy: GuardrailPolicy, pathname: string): boolean {
  return policy.allowedRoutes.some((routePattern) => routeMatches(routePattern, pathname));
}

export function routeMatches(pattern: string, pathname: string): boolean {
  const normalize = (value: string) => (value.length > 1 ? value.replace(/\/+$/, "") : value);
  const patternParts = normalize(pattern).split("/").filter(Boolean);
  const pathParts = normalize(pathname).split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return false;
  }

  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

export function resolveUrl(target: string, baseUrl: string): URL | undefined {
  try {
    return new URL(target, baseUrl);
  } catch {
    return undefined;
  }
}

function deny(code: PolicyDenialCode, reason: string): PolicyDecision {
  return { allowed: false, requiresHuman: false, code, reason };
}
