export const config = {
  maxTurns: Number(process.env.MAX_TURNS ?? 30),
  maxDurationMs: Number(process.env.MAX_DURATION_MS ?? 15 * 60 * 1000),
  workspacePath: process.env.WORKSPACE_PATH ?? "/workspace",
  branchPrefix: "agent/",
  protectedBranches: ["main", "master"],
  dryRun: process.env.DRY_RUN === "true",
};
