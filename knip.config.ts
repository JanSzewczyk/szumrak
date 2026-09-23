import type { KnipConfig } from "knip";

const config: KnipConfig = {
  /** `dev:run` launches this via `node .../tsx/dist/cli.mjs`, which Knip can't trace from package.json. */
  entry: ["scripts/dev-run.ts"],
  project: ["src/**/*.ts", "scripts/**/*.ts"],
  /** Types like `AgentPermissions` are exported as part of an exported interface's shape in the same file. */
  ignoreExportsUsedInFile: {
    interface: true,
    type: true
  }
};

export default config;
