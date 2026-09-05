# Computer-Use Automation Assessment

Small end-to-end computer-use automation system for a legacy-style fake bank back-office app.

The system supports:

- LLM-driven discovery against a real browser surface.
- A typed, versioned capability artifact.
- Deterministic replay without LLM decisions.
- Policy guardrails and redacted evidence logging.
- Human handoff on blocked/risky runtime states.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

For a real discovery run, set:

```bash
export OPENAI_API_KEY="your-key"
```

Optional environment variables:

```bash
export APP_BASE_URL="http://localhost:3000"
export OPENAI_MODEL="gpt-4.1-mini"
```

## Run The App

```bash
npm run app
```

The local fake bank app runs at `http://localhost:3000` by default.

Useful fake members:

- `12345`: successful lookup.
- `99999`: member-not-found business outcome.
- `22222`: restricted profile requiring human handoff.
- `55555`: slow profile load.

## Discovery Demo

Real OpenAI-backed discovery:

```bash
npm run discover -- --goal "Look up member 12345 and read their current savings balance" --memberId 12345
```

Offline/mock discovery for local validation without an API key:

```bash
npm run discover -- --mock --goal "Look up member 12345 and read their current savings balance" --memberId 12345
```

Both commands write a capability artifact to:

`artifacts/lookup-member-savings-balance.json`

Evidence is written under:

`evidence/`

## Replay Demo

Replay the saved artifact without using the LLM:

```bash
npm run replay -- --artifact artifacts/lookup-member-savings-balance.json --memberId 12345
```

Business outcome example:

```bash
npm run replay -- --artifact artifacts/lookup-member-savings-balance.json --memberId 99999
```

Handoff request example:

```bash
npm run replay -- --artifact artifacts/lookup-member-savings-balance.json --memberId 22222
```

Interactive handoff on the same live browser session:

```bash
npm run replay -- --artifact artifacts/lookup-member-savings-balance.json --memberId 22222 --handoff prompt --headed
```

Automated demo handoff, used only to prove the pause/resume seam in non-interactive runs:

```bash
npm run replay -- --artifact artifacts/lookup-member-savings-balance.json --memberId 22222 --handoff auto
```

## Evidence

Curated deliverable evidence is under:

`evidence/final/`

It includes:

- discovery evidence log and final screenshot
- saved capability artifact
- replay success evidence
- member-not-found business outcome evidence
- handoff evidence with intervention request and before/after screenshots

If `OPENAI_API_KEY` is not available, discovery evidence can be generated in `--mock` mode, but the final assessment requires one genuine OpenAI-backed discovery run.

## Development Checks

```bash
npm run typecheck
```

No real customer data or credentials are used. Artifacts and logs redact declared sensitive outputs.
