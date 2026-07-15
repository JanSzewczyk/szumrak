import type { CommitMetadata } from "~/agent/commit-metadata";
import { env } from "~/platform/env";
import { log } from "~/platform/logger";
import { octokit } from "./client";
import { buildBranchName, buildCommitMessage, configureGitRemoteAuth, git } from "./git-operations";
import { parseRepo } from "./repo";

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
