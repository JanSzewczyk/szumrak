import { Mode } from "~/types/mode";
import { runReviewFollowUp } from "./review-followup/run-review-followup-flow";
import { runRunnerFlow } from "./runner/run-runner-flow";
import type { FlowResult } from "./types";

// Shared shape every flow's runner is invoked with — a superset of what any
// single flow needs today. Adding a flow that needs a genuinely new input
// means adding a field here, not changing every existing flow's signature.
export interface FlowContext {
  task?: string;
  owner?: string;
  repo?: string;
  prNumber?: number;
  reviewFeedback?: string;
}

// The single place that maps a Mode to the flow that handles it. Typed as
// Record<Mode, ...> so adding a new value to Mode (types/mode.ts) without a
// matching entry here is a compile error, not a silent no-op at runtime.
export const flowRegistry: Record<Mode, (ctx: FlowContext) => Promise<FlowResult>> = {
  [Mode.RUNNER]: (ctx) => runRunnerFlow(ctx.task as string),
  [Mode.REVIEW_FOLLOWUP]: (ctx) =>
    runReviewFollowUp(ctx.owner as string, ctx.repo as string, ctx.prNumber as number, ctx.reviewFeedback as string)
};
