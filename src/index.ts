import { runAgent } from "./runAgent.js";
import { validateSkillUsage } from "./validation.js";
import { commitAndOpenPR } from "./git.js";
import { config } from "./config.js";
import { log } from "./logger.js";

async function main() {
  const task = process.env.TASK;
  if (!task) {
    console.error("Brak zmiennej TASK");
    process.exit(1);
  }

  try {
    const result = await runAgent(task);

    if (!result.succeeded) {
      log("agent_run_failed", { finalMessage: result.finalMessage });
      console.error("Agent nie zakończył zadania powodzeniem.");
      process.exit(1);
    }

    const violations = validateSkillUsage(task, result);
    if (violations.length > 0) {
      log("aborting_due_to_validation", { violations });
      console.error("Walidacja nie przeszła:\n" + violations.join("\n"));
      process.exit(1);
    }

    if (config.dryRun) {
      log("dry_run_active", { note: "Zmiany pozostają na dysku, PR nie zostanie utworzony." });
      console.log("DRY_RUN=true — zmiany zostawione na dysku, brak commitu i PR-a.");
      return;
    }

    const prUrl = await commitAndOpenPR(
      task.slice(0, 72),
      `Zadanie:\n${task}\n\nWygenerowane automatycznie przez Szumraka.\n\nPodsumowanie modelu:\n${result.finalMessage}`
    );

    if (prUrl) {
      console.log(`PR utworzony: ${prUrl}`);
    } else {
      console.log("Brak zmian do zacommitowania.");
    }
  } catch (err) {
    log("fatal_error", { error: String(err) });
    console.error(err);
    process.exit(1);
  }
}

main();
