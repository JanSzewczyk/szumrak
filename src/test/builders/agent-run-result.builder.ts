import { faker } from "@faker-js/faker";
import { build } from "mimicry-js";
import type { AgentRunResult } from "~/agent/run-agent";
import { commitMetadataBuilder } from "./commit-metadata.builder";

/**
 * Builds an `AgentRunResult` — what `runAgent()` resolves to, consumed by
 * every flow (flows/runner, flows/review-followup).
 *
 * @example
 * agentRunResultBuilder.one();
 * agentRunResultBuilder.one({ overrides: { finalMessage: "Added the feature" } });
 * agentRunResultBuilder.one({ traits: "failed" });
 */
export const agentRunResultBuilder = build<AgentRunResult>({
  fields: {
    toolCalls: [],
    finalMessage: () => faker.lorem.sentence(),
    succeeded: true,
    totalCostUsd: () => faker.number.float({ min: 0, max: 1, fractionDigits: 2 }),
    numTurns: () => faker.number.int({ min: 1, max: 10 }),
    commitMetadata: () => commitMetadataBuilder.one()
  },
  traits: {
    // A failed run never carries cost/turn/commit metadata — runAgent()
    // itself only populates those from a successful SDK "result" message.
    failed: {
      overrides: {
        succeeded: false,
        totalCostUsd: undefined,
        numTurns: undefined,
        commitMetadata: undefined
      }
    }
  }
});
