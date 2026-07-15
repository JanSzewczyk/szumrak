export const Mode = {
  RUNNER: "runner",
  REVIEW_FOLLOWUP: "review-followup"
} as const;

export type Mode = (typeof Mode)[keyof typeof Mode];
