import { env } from "./env";
import { commitAndOpenPR } from "./git";
import { findOpenPRForTask } from "./lib/dedup";
import { log } from "./lib/logger";
import { writeStepSummary } from "./lib/summary";
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
    // Deduplication needs REPO/GH_TOKEN to list PRs, both guaranteed present
    // by the guard above whenever DRY_RUN is off.
    if (!env.DRY_RUN) {
      const [owner, repo] = (env.REPO ?? "").split("/");
      const existingPRUrl = await findOpenPRForTask(owner, repo, env.TASK);
      if (existingPRUrl) {
        console.log(`An open PR already exists for this task, skipping: ${existingPRUrl}`);
        writeStepSummary(`Skipped — an open PR already exists for this task: ${existingPRUrl}`, "ℹ️");
        return;
      }
    }

    const result = await runAgent(env.TASK);

    if (!result.succeeded) {
      log("agent_run_failed", { finalMessage: result.finalMessage });
      console.error("The agent did not complete the task successfully.");
      writeStepSummary(`Task did not complete successfully: ${result.finalMessage.slice(0, 300)}`);
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
    writeStepSummary(`Fatal error: ${String(err).slice(0, 300)}`);
    process.exit(1);
  }
}

main();
