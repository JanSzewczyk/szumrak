export const Mode = {
  RUNNER: "runner",
  REVIEW_FOLLOWUP: "review-followup",
  ASK: "ask"
} as const;

export type Mode = (typeof Mode)[keyof typeof Mode];
