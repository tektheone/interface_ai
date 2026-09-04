import "dotenv/config";
import { Command } from "commander";
import { startFakeBankServer } from "../app/server.js";

const program = new Command();

program
  .name("serve")
  .description("Start the local fake bank back-office app")
  .option("-p, --port <port>", "Port to listen on", process.env.PORT ?? "3000")
  .parse(process.argv);

const options = program.opts<{ port: string }>();
const port = Number(options.port);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid port: ${options.port}`);
}

startFakeBankServer({ port });
