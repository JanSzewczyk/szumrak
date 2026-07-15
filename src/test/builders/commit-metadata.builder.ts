import { faker } from "@faker-js/faker";
import { build, oneOf } from "mimicry-js";
import type { CommitMetadata } from "~/agent/commit-metadata";

/**
 * Builds a `CommitMetadata` — the agent-reported Conventional Commits
 * type/scope/subject/branch parsed by `agent/commit-metadata.ts`.
 *
 * @example
 * commitMetadataBuilder.one();
 * commitMetadataBuilder.one({ overrides: { type: "fix", scope: undefined } });
 * commitMetadataBuilder.many(3);
 */
export const commitMetadataBuilder = build<CommitMetadata>({
  fields: {
    type: oneOf("feat", "fix", "chore", "docs", "style", "refactor", "perf", "test", "build", "ci", "revert"),
    scope: () => faker.hacker.noun(),
    subject: () => faker.git.commitMessage(),
    branchSlug: () => faker.helpers.slugify(faker.git.branch()).toLowerCase()
  }
});
