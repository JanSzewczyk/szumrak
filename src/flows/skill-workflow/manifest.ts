import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { skillWorkflowManifestPath } from "~/platform/target-repo-layout";
import { SkillWorkflowConfigError } from "./errors";
import { type SkillWorkflowManifest, SkillWorkflowManifestSchema } from "./manifest-schema";

/**
 * Loads and validates the named manifest. Unlike agent-config.json (where a
 * missing/broken file just means "no extra config"), a skill workflow run
 * can't do anything sensible without its manifest, so every problem throws a
 * {@link SkillWorkflowConfigError} with a readable message.
 *
 * `name` is already restricted to a slug by platform/env.ts, so it can't
 * escape `.claude/szumrak/skill-workflows/`.
 */
export function loadSkillWorkflowManifest(workspacePath: string, name: string): SkillWorkflowManifest {
  const relativePath = skillWorkflowManifestPath(name);
  const manifestPath = join(workspacePath, relativePath);
  if (!existsSync(manifestPath)) {
    throw new SkillWorkflowConfigError(`Skill workflow manifest not found: ${relativePath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new SkillWorkflowConfigError(`${relativePath} is not valid JSON: ${String(err)}`);
  }

  const parsed = SkillWorkflowManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SkillWorkflowConfigError(`${relativePath} is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
