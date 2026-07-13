import { env } from "./env";
import { commitAndOpenPR } from "./git";
import { log } from "./lib/logger";
import { runAgent } from "./run-agent";

async function main() {
  // env (validated in ./env) guarantees TASK is present. When not a dry run we
  // also need REPO + GH_TOKEN to open the PR — check upfront so a misconfigured
  // run fails before spending an API turn rather than after.
  if (!env.DRY_RUN && (!env.REPO || !env.GH_TOKEN)) {
    console.error("REPO and GH_TOKEN are required unless DRY_RUN=true.");
    process.exit(1);
  }

  try {
    const result = await runAgent(env.TASK);

    if (!result.succeeded) {
      log("agent_run_failed", { finalMessage: result.finalMessage });
      console.error("The agent did not complete the task successfully.");
      process.exit(1);
    }

    if (env.DRY_RUN) {
      log("dry_run_active", { note: "Changes are left on disk; no PR will be created." });
      console.log("DRY_RUN=true — changes left on disk, no commit or PR.");
      console.log(`\nAgent result:\n${result.finalMessage}`);
      return;
    }

    const prUrl = await commitAndOpenPR(
      env.TASK.slice(0, 72),
      `Task:\n${env.TASK}\n\nGenerated automatically by Szumrak.\n\nModel summary:\n${result.finalMessage}`,
      result.commitMetadata
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
