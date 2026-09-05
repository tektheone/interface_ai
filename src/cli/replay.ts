import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { CapabilityArtifactSchema, parseCapabilityArtifact, type CapabilityArtifact } from "../artifact/schema.js";
import { lookupMemberSavingsBalanceArtifact } from "../artifact/example-artifact.js";
import type { HandoffMode } from "../handoff/index.js";
import { replayCapability } from "../replay/replay.js";

const program = new Command();

program
  .name("replay")
  .description("Replay a saved capability artifact deterministically without LLM decisions")
  .option("-a, --artifact <path>", "Path to a saved artifact JSON file. Defaults to the built-in seed artifact.")
  .option("--memberId <memberId>", "Member number input for the lookup capability", "12345")
  .option("--base-url <url>", "Override artifact base URL", process.env.APP_BASE_URL)
  .option("--evidence-dir <path>", "Directory where replay evidence is written", "evidence")
  .option("--headed", "Run browser headed instead of headless", false)
  .option("--handoff <mode>", "Human handoff mode: off, prompt, or auto", "off")
  .option("--write-seed-artifact <path>", "Write the built-in seed artifact to a JSON file before replaying")
  .parse(process.argv);

const options = program.opts<{
  artifact?: string;
  memberId: string;
  baseUrl?: string;
  evidenceDir: string;
  headed: boolean;
  handoff: HandoffMode;
  writeSeedArtifact?: string;
}>();

if (!["off", "prompt", "auto"].includes(options.handoff)) {
  throw new Error(`Invalid handoff mode: ${options.handoff}`);
}

const artifact = await loadArtifact(options.artifact);

if (options.writeSeedArtifact) {
  await writeFile(options.writeSeedArtifact, `${JSON.stringify(CapabilityArtifactSchema.parse(lookupMemberSavingsBalanceArtifact), null, 2)}\n`, "utf8");
}

const result = await replayCapability({
  artifact,
  inputs: { memberId: options.memberId },
  baseUrl: options.baseUrl,
  evidenceDir: options.evidenceDir,
  headed: options.headed || options.handoff === "prompt",
  handoffMode: options.handoff
});

console.log(JSON.stringify(result, null, 2));

if (result.status === "failure") {
  process.exitCode = 1;
}

async function loadArtifact(artifactPath: string | undefined): Promise<CapabilityArtifact> {
  if (!artifactPath) {
    return CapabilityArtifactSchema.parse(lookupMemberSavingsBalanceArtifact);
  }

  return parseCapabilityArtifact(JSON.parse(await readFile(artifactPath, "utf8")));
}
