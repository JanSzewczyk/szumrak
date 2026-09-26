import { resolve } from "node:path";
import { loadSkillWorkflowManifest, SkillWorkflowDelivery } from "~/flows/skill-workflow/manifest";

/**
 * Reads the real file from disk (no fs mock), so a schema change that breaks
 * the manifest shipped in target-repo-templates/ fails here instead of in a
 * target repo's first CI run.
 */
describe("target-repo-templates do-ticket manifest", () => {
  test("passes the skill workflow manifest schema", () => {
    const templatesRoot = resolve(import.meta.dirname, "../../../target-repo-templates");

    const manifest = loadSkillWorkflowManifest(templatesRoot, "do-ticket");

    expect(manifest).toMatchObject({ skill: "do-ticket", delivery: SkillWorkflowDelivery.AGENT });
  });
});
