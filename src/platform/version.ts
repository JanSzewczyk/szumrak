import packageJson from "../../package.json" with { type: "json" };

/**
 * Resolved via a relative import (not `process.cwd()`), so it works
 * identically whether invoked via `npm start` (cwd = repo root) or the
 * Docker image's `tsx src/index.ts` entrypoint (cwd = /agent) — both lay out
 * `package.json` two directories above this file.
 */
export const SZUMRAK_VERSION = packageJson.version;
