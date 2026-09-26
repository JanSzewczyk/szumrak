import { log } from "~/platform/logger";
import { octokit } from "./client";

/**
 * Notion page 16's original design matches an existing open PR by
 * `#${issueNumber}` in its body — not available here, since the workflow is
 * `workflow_dispatch` only (no `issue_comment` trigger, no issue number). The
 * literal task text is the only stable identifier available, and it's
 * already written verbatim into the PR body as "Task:\n<TASK>" by index.ts.
 */
export async function findOpenPRForTask(owner: string, repo: string, task: string): Promise<string | null> {
  const { data: openPRs } = await octokit.pulls.list({ owner, repo, state: "open" });
  const existing = openPRs.find((pr) => pr.body?.includes(`Task:\n${task}`));
  if (!existing) {
    return null;
  }
  log("task_already_handled", { url: existing.html_url });
  return existing.html_url;
}

/**
 * Same idea as {@link findOpenPRForTask}, keyed on an invisible HTML-comment
 * marker instead of "Task:\n<TASK>" text — a skill workflow's PR body may be
 * written by the target repo's own skill, so Szumrak can't rely on its layout,
 * only on a marker it appends itself.
 */
export async function findOpenPRWithMarker(owner: string, repo: string, marker: string): Promise<string | null> {
  const { data: openPRs } = await octokit.pulls.list({ owner, repo, state: "open", per_page: 100 });
  const existing = openPRs.find((pr) => pr.body?.includes(marker));
  if (!existing) {
    return null;
  }
  log("task_already_handled", { url: existing.html_url });
  return existing.html_url;
}
