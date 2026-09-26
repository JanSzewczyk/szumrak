/**
 * The skill workflow can't start: its manifest, inputs, secrets or the files
 * it references are missing or invalid. The message is written for a human
 * reading the CI step summary and never includes a secret value.
 */
export class SkillWorkflowConfigError extends Error {
  override name = "SkillWorkflowConfigError";
}

/** One of the manifest's `setup` commands failed, so the agent never started. */
export class SkillWorkflowSetupError extends Error {
  override name = "SkillWorkflowSetupError";
}
