import { log } from "~/platform/logger";

const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "chore",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert"
] as const;
type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

export interface CommitMetadata {
  type: ConventionalCommitType;
  scope?: string;
  subject: string;
  branchSlug: string;
}

/**
 * Appended to the system prompt so the agent — the one that actually knows
 * what it changed and why — produces the commit metadata itself, instead of
 * git-operations.ts guessing a commit type from the raw task text (which used
 * to always commit as "chore(agent): ...", regardless of the real change;
 * craft-flow's semantic-release parses commit type for versioning, so a wrong
 * type is a real bug, not just cosmetic). Runs in the same turn as the edits,
 * so it costs no extra API call.
 */
export const COMMIT_METADATA_INSTRUCTIONS = `
When you have finished making all edits for this task, end your final response with exactly one fenced block using these four field names literally, each on its own line. Keep "type" and "subject" as separate lines — do not collapse them into one "type: subject" line the way a real commit message reads.

\`\`\`commit
type: <feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert — pick exactly one>
scope: <short kebab-case scope, or delete this line if there is none>
subject: <imperative mood, lowercase, no trailing period, at most 50 characters>
branch: <kebab-case slug describing the change, at most 40 characters, no type prefix>
\`\`\`

Example, for a change that added tests for a search-params helper:

\`\`\`commit
type: test
scope: search-params
subject: add unit tests for parseSearchParams
branch: add-search-params-tests
\`\`\`

Describe the change you actually made, not the wording of the task. If you made no changes, omit this block entirely.
`.trim();

export const COMMIT_BLOCK_PATTERN = /```commit\s*\n([\s\S]*?)```/;

export function parseCommitMetadata(finalMessage: string): CommitMetadata | undefined {
  const match = finalMessage.match(COMMIT_BLOCK_PATTERN);
  if (!match) {
    return undefined;
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const fieldMatch = line.match(/^(type|scope|subject|branch):\s*(.+)$/);
    if (fieldMatch) {
      fields[fieldMatch[1]] = fieldMatch[2].trim();
    }
  }

  /**
   * Tolerate the model collapsing "type: <type>" and "subject: <subject>"
   * into a single conventional-commit-style line (e.g. a bare
   * "test: add unit tests..." line instead of separate "type:"/"subject:"
   * lines) — an easy mistake since that's what the final commit message is
   * supposed to look like. Neither "type" nor "subject" matches the strict
   * field regex above in that case, so scan every line for one that starts
   * with a valid conventional commit type.
   */
  if (!fields.type || !CONVENTIONAL_COMMIT_TYPES.includes(fields.type as ConventionalCommitType)) {
    for (const line of match[1].split("\n")) {
      const collapsed = line.match(/^(\w+):\s*(.+)$/);
      if (collapsed && CONVENTIONAL_COMMIT_TYPES.includes(collapsed[1] as ConventionalCommitType)) {
        fields.type = collapsed[1];
        fields.subject ??= collapsed[2];
        break;
      }
    }
  }

  const type = fields.type as ConventionalCommitType;
  if (!CONVENTIONAL_COMMIT_TYPES.includes(type) || !fields.subject || !fields.branch) {
    log("commit_metadata_invalid", { fields });
    return undefined;
  }

  const branchSlug = fields.branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!branchSlug) {
    log("commit_metadata_invalid", { fields });
    return undefined;
  }

  return { type, scope: fields.scope || undefined, subject: fields.subject.slice(0, 50), branchSlug };
}
