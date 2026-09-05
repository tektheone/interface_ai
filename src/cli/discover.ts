import "dotenv/config";
import { Command } from "commander";
import { runDiscovery } from "../agent/index.js";

const program = new Command();

program
  .name("discover")
  .description("Run an LLM-driven discovery pass and save a replayable capability artifact")
  .requiredOption("--goal <goal>", "Natural-language goal for the target app")
  .option("--memberId <memberId>", "Fake member number to use during discovery", "12345")
  .option("--base-url <url>", "Target app base URL", process.env.APP_BASE_URL ?? "http://localhost:3000")
  .option("--artifact <path>", "Where to write the discovered artifact", "artifacts/lookup-member-savings-balance.json")
  .option("--evidence-dir <path>", "Directory where discovery evidence is written", "evidence")
  .option("--model <model>", "OpenAI model for discovery", process.env.OPENAI_MODEL ?? "gpt-4.1-mini")
  .option("--mock", "Use deterministic mock decisions instead of OpenAI", false)
  .option("--headed", "Run browser headed instead of headless", false)
  .option("--max-steps <count>", "Maximum discovery steps", "10")
  .parse(process.argv);

const options = program.opts<{
  goal: string;
  memberId: string;
  baseUrl: string;
  artifact: string;
  evidenceDir: string;
  model: string;
  mock: boolean;
  headed: boolean;
  maxSteps: string;
}>();

const result = await runDiscovery({
  goal: options.goal,
  memberId: options.memberId,
  baseUrl: options.baseUrl,
  artifactPath: options.artifact,
  evidenceDir: options.evidenceDir,
  model: options.model,
  apiKey: process.env.OPENAI_API_KEY,
  mock: options.mock,
  headed: options.headed,
  maxSteps: Number(options.maxSteps)
});

console.log(JSON.stringify(result, null, 2));

if (result.status === "failure") {
  process.exitCode = 1;
}
