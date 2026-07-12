import { config } from "./config.js";
import { log } from "./logger.js";
import type { AgentRunResult } from "./runAgent.js";

// Kształt `input` wywołania narzędzia "Skill" nie jest jawnie eksportowany w
// typach SDK (stan na @anthropic-ai/claude-agent-sdk@0.3.207) — sprawdzamy
// kilka prawdopodobnych nazw pól defensywnie. Do zweryfikowania w
// agent-run.jsonl z pierwszego realnego przebiegu i ewentualnego zawężenia.
function extractSkillName(input: Record<string, unknown>): string | undefined {
  return (
    (input.skillName as string | undefined) ??
    (input.skill as string | undefined) ??
    (input.name as string | undefined) ??
    (input.command as string | undefined)
  );
}

export function validateSkillUsage(task: string, result: AgentRunResult): string[] {
  const violations: string[] = [];
  const taskLower = task.toLowerCase();

  const usedSkills = result.toolCalls
    .filter((tc) => tc.name === "Skill")
    .map((tc) => extractSkillName(tc.input))
    .filter((name): name is string => Boolean(name));

  for (const [keyword, requiredSkill] of Object.entries(config.requiredSkillKeywords)) {
    if (taskLower.includes(keyword) && !usedSkills.includes(requiredSkill)) {
      violations.push(`Zadanie zawiera "${keyword}" ale nie użyto wymaganego skilla "${requiredSkill}"`);
    }
  }

  if (violations.length > 0) {
    log("validation_failed", { violations, usedSkills });
  }

  return violations;
}
