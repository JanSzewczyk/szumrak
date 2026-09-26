import { SkillWorkflowConfigError, type SkillWorkflowManifest } from "./manifest";

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SkillWorkflowConfigError(`${label} is not valid JSON: ${String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SkillWorkflowConfigError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Validates `SKILL_WORKFLOW_INPUTS` against the manifest's input definitions
 * and returns them as strings. Inputs are untrusted (they may come from a
 * GitHub event payload), so anything undeclared is rejected rather than
 * passed through, and every value is length-capped and pattern-checked.
 *
 * An empty string counts as "not given": `workflow_dispatch` sends `""` for
 * every optional input the user left blank.
 */
export function resolveSkillWorkflowInputs(manifest: SkillWorkflowManifest, rawInputs: string): Record<string, string> {
  const given = parseJsonObject(rawInputs, "SKILL_WORKFLOW_INPUTS");
  const errors: Array<string> = [];
  const resolved: Record<string, string> = {};

  for (const name of Object.keys(given)) {
    if (!(name in manifest.inputs)) {
      errors.push(`unknown input "${name}"`);
    }
  }

  for (const [name, definition] of Object.entries(manifest.inputs)) {
    const value = given[name];
    if (value === undefined || value === null || value === "") {
      if (definition.required) {
        errors.push(`input "${name}" is required`);
      }
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      errors.push(`input "${name}" must be a string, number or boolean`);
      continue;
    }

    const text = String(value);
    if (text.length > definition.maxLength) {
      errors.push(`input "${name}" exceeds ${definition.maxLength} characters`);
      continue;
    }
    if (definition.pattern && !new RegExp(`^(?:${definition.pattern})$`).test(text)) {
      errors.push(`input "${name}" does not match ${definition.pattern}`);
      continue;
    }
    resolved[name] = text;
  }

  if (errors.length > 0) {
    throw new SkillWorkflowConfigError(`Invalid skill workflow inputs: ${errors.join("; ")}`);
  }
  return resolved;
}

/**
 * Parses `SKILL_WORKFLOW_SECRETS` and checks that every secret the manifest
 * declares is present. Error messages name the missing secrets, never any
 * values. Only declared secrets are returned — anything extra is dropped.
 */
export function resolveSkillWorkflowSecrets(
  manifest: SkillWorkflowManifest,
  rawSecrets: string | undefined
): Record<string, string> {
  const given = rawSecrets ? parseJsonObject(rawSecrets, "SKILL_WORKFLOW_SECRETS") : {};
  const missing = manifest.secrets.filter((name) => typeof given[name] !== "string" || given[name] === "");
  if (missing.length > 0) {
    throw new SkillWorkflowConfigError(
      `Missing secrets declared by the skill workflow: ${missing.join(", ")} — add them under the target repo's Settings → Secrets and variables → Actions`
    );
  }
  return Object.fromEntries(manifest.secrets.map((name) => [name, given[name] as string]));
}
