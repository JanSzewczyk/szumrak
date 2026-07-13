import { execFileSync } from "node:child_process";
import { octokit } from "~/lib/github";
import { env } from "./env";
import { log } from "./lib/logger";
import type { CommitMetadata } from "./run-agent";

// Prefix for branches the agent creates.
const BRANCH_PREFIX = "agent/";

// A short suffix keeps branch names unique across runs that produce the same
// type/slug (e.g. two "test/add-x-tests" runs on different days).
function buildBranchName(commitMetadata: CommitMetadata | undefined): string {
  const uniqueSuffix = Date.now().toString(36);
  if (!commitMetadata) {
    return uniqueSuffix;
  }
  return `${commitMetadata.type}/${commitMetadata.branchSlug}-${uniqueSuffix}`;
}

// Falls back to the old behavior (always "chore(agent): <task text>") when
// the agent didn't emit a parseable commit block — see run-agent.ts.
function buildCommitMessage(commitMetadata: CommitMetadata | undefined, taskSummary: string): string {
  if (!commitMetadata) {
    return `chore(agent): ${taskSummary.slice(0, 72)}`;
  }
  const scope = commitMetadata.scope ? `(${commitMetadata.scope})` : "";
  return `${commitMetadata.type}${scope}: ${commitMetadata.subject}`;
}

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

// actions/checkout persists a credential helper in the checked-out repo's
// .git/config, but that doesn't reliably carry into this container (mounted
// volume, different UID/HOME, and the runner's own checkout may not even be
// the directory that ends up mounted as WORKSPACE_PATH). Embedding the token
// in the remote URL is explicit and doesn't depend on any of that. Bypasses
// the git() wrapper so the token is never written to agent-run.jsonl.
function configureGitRemoteAuth(owner: string, repo: string): void {
  const authedUrl = `https://x-access-token:${env.GH_TOKEN}@github.com/${owner}/${repo}.git`;
  execFileSync("git", ["remote", "set-url", "origin", authedUrl], { cwd: env.WORKSPACE_PATH });
  log("git", { args: ["remote", "set-url", "origin", "<redacted>"] });
}

export async function commitAndOpenPR(
  taskSummary: string,
  body: string,
  commitMetadata?: CommitMetadata
): Promise<string | null> {
  const branch = buildBranchName(commitMetadata);
  const commitMessage = buildCommitMessage(commitMetadata, taskSummary);

  const [owner, repo] = (env.REPO ?? "").split("/");
  if (!owner || !repo) {
    throw new Error("The REPO environment variable must be in 'owner/repo' format");
  }
  configureGitRemoteAuth(owner, repo);

  git(["checkout", "-b", branch]);

  const status = git(["status", "--porcelain"]);
  if (!status.trim()) {
    log("no_changes");
    return null;
  }

  git(["add", "-A"]);
  git(["commit", "-m", commitMessage]);
  git(["push", "origin", branch]);

  const pr = await octokit.pulls.create({
    owner,
    repo,
    // GitHub's default squash-merge uses the PR title as the final commit
    // message on the base branch, which is what craft-flow's semantic-release
    // actually parses — so this needs to be the real Conventional Commits
    // subject, not a human-readable label like "[agent] <task>".
    title: commitMessage,
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
