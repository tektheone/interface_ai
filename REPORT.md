# Architecture

The project is a single-process TypeScript system with a local fake bank app, a browser automation layer, an LLM discovery loop, a deterministic replay engine, policy guardrails, evidence logging, and a handoff controller. The target app is intentionally legacy-like: table layouts, no test IDs, minimal semantic affordances, and runtime states for not-found, validation, slow load, and restricted-member review.

Discovery uses Playwright to observe and act on the real UI, while OpenAI chooses the next action from a constrained JSON action schema. Replay never calls the model. It loads the saved capability artifact, resolves locators, executes steps, verifies conditions, extracts outputs, and returns a typed result. This separation keeps the expensive/non-deterministic model in the record path and keeps production invocation deterministic and reviewable.

# Artifact schema

The artifact is a typed, versioned capability contract rather than a raw model transcript. It contains capability metadata, target app metadata, typed inputs, typed outputs, guardrail policy, ordered steps, locator strategy, extraction rules, success condition, and known business outcomes.

Each target has a primary locator and fallbacks with a robustness explanation. The schema supports role, label, text, CSS, XPath, accessibility, and coordinate locator kinds so the recorded flow is not tied to a clean DOM-only world. Inputs and outputs carry sensitivity/redaction metadata so replay and evidence code can avoid persisting regulated data in logs.

# Determinism & error handling

Replay executes fixed artifact steps with bounded Playwright timeouts. It performs policy checks before each action, substitutes typed inputs into templates such as `{{memberId}}`, waits for expected conditions, and extracts declared outputs. The result contract distinguishes `success`, `business_outcome`, `recoverable`, `requires_human`, and `failure`.

Expected business outcomes, such as `member_not_found` and `invalid_member_number`, are modeled as caller-visible outcomes rather than crashes. Restricted-member review is modeled as `requires_human`. Hard failures include step ID, message, and evidence references. Failure evidence includes screenshots and DOM snapshots when available.

# Heterogeneity & multi-tenant

The replay engine currently implements a web surface adapter through Playwright, but the artifact schema separates the recorded flow from the surface-specific perception/action implementation. A desktop or accessibility-tree adapter could implement the same action and locator concepts with OS accessibility APIs or screenshot/coordinate control while preserving the artifact contract.

For multi-tenant reuse, artifacts include vendor, app version, surface type, and tenant scope. A base vendor-version artifact can be reused across institutions, while tenant overrides can specialize routes, locators, or policy settings. Drift should be detected through replay failures, checkpoint mismatches, and locator fallback rates, then managed by versioning artifacts and promoting reviewed overrides back into a vendor-level artifact when they generalize.

# Escalation & handoff

Replay detects handoff conditions through policy decisions or artifact error mappings. On a restricted profile, automation pauses on the same Playwright page, writes an intervention request, captures a before screenshot, and either returns `requires_human` or waits for the operator to resume.

The `--handoff prompt --headed` mode opens the real browser session for manual control and waits for the operator to press Enter before continuing. The `--handoff auto` mode is only a demo helper that resolves the known fake-bank dialog to prove the pause/resume seam in non-interactive verification. Handoff evidence includes request JSON and before/after screenshots.

# Safety

Guardrails enforce allowed origins, allowed routes, allowed action types, blocked risk levels, and risk levels that require a human. Runtime base URL overrides update the allowed origin deliberately so local verification ports do not weaken the policy model.

Artifacts and logs avoid secrets. `.env` files are ignored, and evidence writers redact obvious secret-like strings plus declared sensitive outputs such as member names and balances. The demo uses fake data only. The current redaction model is conservative but not a substitute for production-grade data classification.

# Cuts

The operator console is intentionally minimal: CLI prompt plus the same live browser session, not real-time co-browsing. The desktop surface is represented by schema seams but not implemented. Discovery is constrained to a small action schema and one target flow. There is no queueing, multi-tenant storage service, approval workflow, or capability catalog API.

With more time, I would add artifact approval states, multi-run stability scoring, a bounded LLM recovery mode for a single failed replay step, and a second tenant variant to demonstrate locator overrides and cross-tenant reuse.
