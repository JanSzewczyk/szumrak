import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "~/platform/logger";

export interface HookHealthReport {
  total: number;
  failed: Array<{ event: string; command: string }>;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    log("hook_preflight_config_invalid", { path, error: String(err) });
    return undefined;
  }
}

function isCommandCheckOk(command: string): boolean {
  try {
    execFileSync("/bin/sh", ["-n", "-c", command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dry-run-checks every hook command in the target repo's own
 * `.claude/settings.json` with `sh -n` (parses without executing), so a
 * broken hook (e.g. bash-only `[[ ... ]]` syntax under `/bin/sh`) is caught
 * before the agent's session — never runs the command for real.
 */
export function checkHookHealth(workspacePath: string): HookHealthReport {
  const settingsPath = join(workspacePath, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { total: 0, failed: [] };
  }

  const raw = readJson(settingsPath);
  if (typeof raw !== "object" || raw === null) {
    return { total: 0, failed: [] };
  }

  const { hooks } = raw as Record<string, unknown>;
  if (typeof hooks !== "object" || hooks === null) {
    return { total: 0, failed: [] };
  }

  let total = 0;
  const failed: Array<{ event: string; command: string }> = [];

  for (const [event, matcherGroups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(matcherGroups)) {
      continue;
    }
    for (const matcherGroup of matcherGroups) {
      const entries = (matcherGroup as { hooks?: unknown })?.hooks;
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        const command = (entry as { command?: unknown })?.command;
        if (typeof command !== "string") {
          continue;
        }
        total += 1;
        if (!isCommandCheckOk(command)) {
          failed.push({ event, command });
        }
      }
    }
  }

  return { total, failed };
}
