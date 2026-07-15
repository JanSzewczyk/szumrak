import { execFileSync } from "node:child_process";

export interface VerifyOutcome {
  passed: boolean;
  /** Per-command failure sections (`$ command` + captured output); empty when passed. */
  report: string;
}

/** Keeps a noisy tool's output from blowing up the hook feedback / logs. */
const MAX_OUTPUT_CHARS = 4000;

/**
 * Runs the target repo's `verify` commands (from `.claude/agent-config.json`)
 * inside the workspace and collects every failure instead of stopping at the
 * first, so the agent gets the full picture in one round.
 *
 * Commands are split on whitespace and executed via `execFileSync` with an
 * argument array — never through a shell — matching the repo-wide
 * command-injection invariant (see github/git-operations.ts). This means no
 * pipes, quoting, or env-var expansion in `verify` entries; plain
 * `npm run <script>` style commands only, with any shell logic living inside
 * the target repo's own package.json scripts.
 */
export function runVerifyCommands(commands: Array<string>, cwd: string): VerifyOutcome {
  const failures: Array<string> = [];

  for (const command of commands) {
    const [file, ...args] = command.split(/\s+/).filter(Boolean);
    if (!file) {
      continue;
    }
    try {
      execFileSync(file, args, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (err) {
      const { stdout, stderr, message } = err as { stdout?: string; stderr?: string; message?: string };
      const output = [stdout, stderr].filter(Boolean).join("\n").trim() || (message ?? String(err));
      failures.push(`$ ${command}\n${output.slice(0, MAX_OUTPUT_CHARS)}`);
    }
  }

  return { passed: failures.length === 0, report: failures.join("\n\n") };
}
