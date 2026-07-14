import { execFileSync } from "node:child_process";
import { getInstallationToken, octokit } from "~/lib/github";
import { env } from "./env";
import { log } from "./lib/logger";
import type { CommitMetadata } from "./run-agent";

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
async function configureGitRemoteAuth(owner: string, repo: string): Promise<void> {
  const token = await getInstallationToken();
  const authedUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  execFileSync("git", ["remote", "set-url", "origin", authedUrl], { cwd: env.WORKSPACE_PATH });
  log("git", { args: ["remote", "set-url", "origin", "<redacted>"] });
}

// Shared by commitAndOpenPR, the dedup check, and review-followup — all three
// need owner/repo split out of REPO ("owner/repo").
export function parseRepo(repo: string | undefined): { owner: string; repo: string } {
  const [owner, name] = (repo ?? "").split("/");
  if (!owner || !name) {
    throw new Error("The REPO environment variable must be in 'owner/repo' format");
  }
  return { owner, repo: name };
}

// Checks out an existing PR branch instead of creating a new one — the
// review-followup path must run the agent against the branch's current state
// (including whatever the agent already changed in earlier rounds), not a
// fresh checkout of main.
export async function checkoutExistingBranch(owner: string, repo: string, branch: string): Promise<void> {
  await configureGitRemoteAuth(owner, repo);
  git(["fetch", "origin", branch]);
  git(["checkout", branch]);
  git(["pull", "origin", branch]);
}

const MAX_DIFF_LENGTH = 4000;

// Included in the review-followup prompt so the model sees the scope of its
// own prior changes without re-reading the whole repo. Truncated for the same
// reason logger.ts truncates long strings — a huge diff is more prompt noise
// than a diff summary would be. Defaults to the remote-tracking ref, not a
// bare "main": actions/checkout leaves HEAD detached with no local branch
// named "main" (only refs/remotes/origin/main), which a real CI run hit and
// a local test with an actual local "main" branch didn't catch.
export function diffAgainstBase(baseBranch = "origin/main"): string {
  const diff = git(["diff", `${baseBranch}...HEAD`]);
  if (diff.length <= MAX_DIFF_LENGTH) {
    return diff;
  }
  return `${diff.slice(0, MAX_DIFF_LENGTH)}\n... [truncated, ${diff.length} chars total]`;
}

// Follow-up commits land on the PR's existing branch — GitHub updates the
// open PR automatically once a new commit lands on it, so there is no PR to
// create here (unlike commitAndOpenPR). Assumes checkoutExistingBranch already
// ran, so the workspace is already on the right branch.
export function pushFollowUpCommit(taskSummary: string, commitMetadata?: CommitMetadata): boolean {
  const status = git(["status", "--porcelain"]);
  if (!status.trim()) {
    log("no_changes");
    return false;
  }

  const commitMessage = buildCommitMessage(commitMetadata, taskSummary);
  git(["add", "-A"]);
  git(["commit", "-m", commitMessage]);
  git(["push", "origin", "HEAD"]);
  return true;
}

export async function commitAndOpenPR(
  taskSummary: string,
  body: string,
  commitMetadata?: CommitMetadata
): Promise<string | null> {
  const branch = buildBranchName(commitMetadata);
  const commitMessage = buildCommitMessage(commitMetadata, taskSummary);

  const { owner, repo } = parseRepo(env.REPO);
  await configureGitRemoteAuth(owner, repo);

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
