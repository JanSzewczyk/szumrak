import { execFileSync } from "node:child_process";
import { passthroughEnv } from "~/agent/agent-auth";
import { log } from "~/platform/logger";
import { SkillWorkflowSetupError } from "./errors";

const SETUP_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

function outputOf(err: unknown): string {
  const { stdout, stderr } = err as { stdout?: Buffer | string; stderr?: Buffer | string };
  return [stdout, stderr]
    .map((stream) => stream?.toString().trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Runs the manifest's `setup` commands, in order, before the agent starts —
 * this is how a skill workflow gets the CLIs it needs into the container.
 *
 * A shell on purpose (unlike github/git-operations.ts): setup entries are
 * written by the target repo's maintainers, read from the default branch, and
 * never carry untrusted text — inputs are not interpolated into them. They get
 * the same allowlisted environment as the agent minus every credential, so a
 * setup script can't read the Claude token, the App key or the workflow's
 * secrets. The first failing command stops the run.
 */
export function runSkillWorkflowSetup(commands: Array<string>, workspacePath: string): void {
  for (const command of commands) {
    log("skill_workflow_setup_start", { command });
    try {
      const output = execFileSync("sh", ["-c", command], {
        cwd: workspacePath,
        env: passthroughEnv(),
        stdio: "pipe",
        timeout: SETUP_COMMAND_TIMEOUT_MS
      });
      log("skill_workflow_setup_done", { command, output: output.toString() });
    } catch (err) {
      const output = outputOf(err);
      log("skill_workflow_setup_failed", { command, error: String(err), output });
      throw new SkillWorkflowSetupError(`Setup command \`${command}\` failed:\n${output.slice(-1500)}`);
    }
  }
}
