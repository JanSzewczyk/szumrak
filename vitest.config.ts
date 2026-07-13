import { defineConfig } from "vitest/config";

// Lets tests import modules that transitively pull in `env.ts` (git.ts,
// run-agent.ts, lib/logger.ts) without crashing. `skipValidation` makes
// createEnv return raw process.env — no parsing, so defaults/transforms from
// the Zod schema never run either. Seed the values modules dereference at
// import time (src/lib/logger.ts reads env.WORKSPACE_PATH at the top level)
// so a bare import doesn't throw; individual tests can still override these.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-api-key";
process.env.TASK ??= "test task";
process.env.WORKSPACE_PATH ??= "/workspace";

export default defineConfig({
  resolve: {
    // Resolves the "~/*" alias from tsconfig.json (used by src/git.ts,
    // src/lib/logger.ts) — without this, Vitest doesn't know about it.
    tsconfigPaths: true
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.ts"],
    // No test files exist yet — keep CI green while the test suite is empty
    // rather than forcing a placeholder test. Drop this once real tests land.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "json"],
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        // Validates env and can process.exit(1) at import time; not meaningfully
        // unit-testable in isolation.
        "src/env.ts",
        // Thin entrypoint that calls main() on import; composes the other
        // (independently tested) modules rather than holding logic itself.
        "src/index.ts"
      ]
    },
    reporters: process.env.GITHUB_ACTIONS === "true" ? ["dot", "github-actions"] : ["default"]
  }
});
