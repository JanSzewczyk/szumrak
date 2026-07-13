import { execFileSync } from "node:child_process";
import { octokit } from "~/lib/github";
import { env } from "./env";
import { log } from "./lib/logger";

// Prefix for branches the agent creates.
const BRANCH_PREFIX = "agent/";

// execFileSync (not execSync) on purpose — arguments are passed as an array,
// with no shell interpolation. The `taskSummary` passed into commitAndOpenPR
// may originate from TASK, which in Phase 5 of the rollout plan is meant to be
// set from a GitHub comment body — i.e. from any user able to comment on an
// issue. A string interpolated into `git commit -m "..."` would be a command
// injection vector (quote escaping, `$()`, backticks, etc.).
function git(args: Array<string>): string {
  log("git", { args });
  return execFileSync("git", args, { cwd: env.WORKSPACE_PATH, encoding: "utf-8" });
}

export async function commitAndOpenPR(taskSummary: string, body: string): Promise<string | null> {
  const branch = `${BRANCH_PREFIX}${Date.now()}`;

  git(["checkout", "-b", branch]);

  const status = git(["status", "--porcelain"]);
  if (!status.trim()) {
    log("no_changes");
    return null;
  }

  git(["add", "-A"]);
  git(["commit", "-m", `chore(agent): ${taskSummary.slice(0, 72)}`]);
  git(["push", "origin", branch]);

  const [owner, repo] = (env.REPO ?? "").split("/");
  if (!owner || !repo) {
    throw new Error("The REPO environment variable must be in 'owner/repo' format");
  }

  const pr = await octokit.pulls.create({
    owner,
    repo,
    title: `[agent] ${taskSummary.slice(0, 72)}`,
    body,
    head: branch,
    base: "main"
  });

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: pr.data.number,
    labels: ["ai-generated"]
  });

  log("pr_created", { url: pr.data.html_url });
  return pr.data.html_url;
}
