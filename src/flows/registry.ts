import { Mode } from "~/types/mode";
import { type AskFlowInput, runAskFlow } from "./ask/run-ask-flow";
import { type ReviewFollowUpFlowInput, runReviewFollowUp } from "./review-followup/run-review-followup-flow";
import { type RunnerFlowInput, runRunnerFlow } from "./runner/run-runner-flow";
import type { FlowResult } from "./types";

/**
 * Maps each {@link Mode} to the exact input its flow needs — not a
 * shared/loosely optional blob every flow's runner has to destructure and
 * cast. Adding a flow means adding its own `<Flow>Input` type here (exported
 * next to the flow's own `run` function) and a matching entry below.
 */
type FlowInputByMode = {
  [Mode.RUNNER]: RunnerFlowInput;
  [Mode.REVIEW_FOLLOWUP]: ReviewFollowUpFlowInput;
  [Mode.ASK]: AskFlowInput;
};

/**
 * The single place that maps a {@link Mode} to the flow that handles it.
 * Typed so each entry's input type is exactly what that mode's flow function
 * expects (via {@link FlowInputByMode}) — callers (index.ts) get full
 * type-checking on the object they pass in, with no `as string`/`as number`
 * casts anywhere in the chain. Also still a `Record`-shaped mapped type over
 * `Mode`, so adding a value to `Mode` without a matching entry here is a
 * compile error, not a silent no-op at runtime.
 */
export const flowRegistry: { [M in Mode]: (input: FlowInputByMode[M]) => Promise<FlowResult> } = {
  [Mode.RUNNER]: runRunnerFlow,
  [Mode.REVIEW_FOLLOWUP]: runReviewFollowUp,
  [Mode.ASK]: runAskFlow
};
