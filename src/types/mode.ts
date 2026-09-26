export const Mode = {
  RUNNER: "runner",
  REVIEW_FOLLOWUP: "review-followup",
  ASK: "ask",
  SKILL_WORKFLOW: "skill-workflow"
} as const;

export type Mode = (typeof Mode)[keyof typeof Mode];
