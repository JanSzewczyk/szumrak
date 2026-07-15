import { log } from "~/platform/logger";
import { octokit } from "./client";

// Notion page 16's original design matches an existing open PR by
// `#${issueNumber}` in its body — not available here, since the workflow is
// `workflow_dispatch` only (no `issue_comment` trigger, no issue number). The
// literal task text is the only stable identifier available, and it's already
// written verbatim into the PR body as "Task:\n<TASK>" by index.ts.
export async function findOpenPRForTask(owner: string, repo: string, task: string): Promise<string | null> {
  const { data: openPRs } = await octokit.pulls.list({ owner, repo, state: "open" });
  const existing = openPRs.find((pr) => pr.body?.includes(`Task:\n${task}`));
  if (!existing) {
    return null;
  }
  log("task_already_handled", { url: existing.html_url });
  return existing.html_url;
}
