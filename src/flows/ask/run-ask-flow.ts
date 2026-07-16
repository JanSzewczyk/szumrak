import { runAgent } from "~/agent/run-agent";
import type { FlowResult } from "~/flows/types";
import { log } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";

export interface AskFlowInput {
  question: string;
}

const INLINE_LINE_LIMIT = 8;

/**
 * Wraps a long answer in a collapsible block so the step summary stays
 * scannable — GITHUB_STEP_SUMMARY renders raw HTML/Markdown, and
 * <details>/<summary> is the standard GH-flavored-markdown collapsible.
 */
function formatAnswer(answer: string): string {
  if (answer.split("\n").length <= INLINE_LINE_LIMIT) {
    return answer;
  }
  return `<details><summary>Answer</summary>\n\n${answer}\n\n</details>`;
}

/**
 * The ask flow: given a question, run the agent read-only against
 * `WORKSPACE_PATH` and write the answer to GITHUB_STEP_SUMMARY. Never
 * commits, pushes, or opens a PR — independent of the runner flow's
 * verify/PR gate (FR8).
 */
export async function runAskFlow({ question }: AskFlowInput): Promise<FlowResult> {
  const result = await runAgent(question, { readOnly: true });

  if (!result.succeeded) {
    log("agent_run_failed", { finalMessage: result.finalMessage });
    writeStepSummary(`Could not answer the question: ${result.finalMessage.slice(0, 300)}`);
    return { succeeded: false };
  }

  writeStepSummary(formatAnswer(result.finalMessage), "✅");
  return { succeeded: true };
}
