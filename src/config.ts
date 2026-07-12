export const config = {
  maxTurns: Number(process.env.MAX_TURNS ?? 30),
  maxDurationMs: Number(process.env.MAX_DURATION_MS ?? 15 * 60 * 1000),
  workspacePath: process.env.WORKSPACE_PATH ?? "/workspace",
  branchPrefix: "agent/",
  protectedBranches: ["main", "master"],
  dryRun: process.env.DRY_RUN === "true",
  // słowo kluczowe w zadaniu -> skill który MUSI zostać użyty
  requiredSkillKeywords: {
    story: "storybook-testing",
    "testy komponentu": "storybook-testing",
    "test wizualny": "storybook-testing",
  } as Record<string, string>,
};
