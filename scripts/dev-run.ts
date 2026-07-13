import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { env } from "~/env";

// A plain npm script with `$TARGET_REPO_PATH:/workspace` only works under a
// POSIX shell. npm on Windows runs scripts through cmd.exe by default, which
// does not expand `$VAR` — the literal string was reaching `docker run -v`
// and failing with "invalid characters for a local volume name". Building the
// docker args here in Node sidesteps shell quoting/expansion differences
// entirely, so this script behaves the same on Windows, macOS, and Linux.
//
// TARGET_REPO_PATH comes from the validated `env` (backed by .env.local via
// the `dev:run` script's --env-file-if-exists), not a one-off shell export.
function main() {
  const targetRepoPath = env.TARGET_REPO_PATH;
  if (!targetRepoPath) {
    console.error("TARGET_REPO_PATH is not set. Add it to .env.local, e.g.:\n");
    console.error("  TARGET_REPO_PATH=/path/to/local/target-repo");
    process.exit(1);
  }

  const absoluteTargetRepoPath = resolve(targetRepoPath);

  const args = [
    "run",
    "--rm",
    "--env-file",
    ".env.local",
    "-e",
    "ANTHROPIC_API_KEY",
    "-e",
    "GH_TOKEN",
    "-e",
    "TASK",
    "-e",
    "REPO",
    "-e",
    "DRY_RUN=true",
    "-v",
    `${absoluteTargetRepoPath}:/workspace`,
    "szumrak"
  ];

  execFileSync("docker", args, { stdio: "inherit" });
}

main();
