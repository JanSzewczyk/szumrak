import { runAgent } from "./run-agent";
import { commitAndOpenPR } from "./git.js";
import { config } from "./config.js";
import { log } from "./logger.js";

async function main() {
  const task = process.env.TASK;
  if (!task) {
    console.error("Missing TASK environment variable");
    process.exit(1);
  }

  try {
    const result = await runAgent(task);

    if (!result.succeeded) {
      log("agent_run_failed", { finalMessage: result.finalMessage });
      console.error("The agent did not complete the task successfully.");
      process.exit(1);
    }

    if (config.dryRun) {
      log("dry_run_active", { note: "Changes are left on disk; no PR will be created." });
      console.log("DRY_RUN=true — changes left on disk, no commit or PR.");
      return;
    }

    const prUrl = await commitAndOpenPR(
      task.slice(0, 72),
      `Task:\n${task}\n\nGenerated automatically by Szumrak.\n\nModel summary:\n${result.finalMessage}`
    );

    if (prUrl) {
      console.log(`PR created: ${prUrl}`);
    } else {
      console.log("No changes to commit.");
    }
  } catch (err) {
    log("fatal_error", { error: String(err) });
    console.error(err);
    process.exit(1);
  }
}

main();
