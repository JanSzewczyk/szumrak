import { log } from "~/platform/logger";

export interface RunInfoRound {
  round: number;
  costUsd?: number;
  numTurns?: number;
}

export interface SzumrakMeta {
  v: 1;
  totalCostUsd?: number;
  rounds: Array<RunInfoRound>;
}

// The hidden HTML comment carries the cost/round data machine-readably, placed
// after the visible table so both stay adjacent at the end of the body. Neither
// ever precedes the "Task:\n...\nGenerated automatically by Szumrak." block
// index.ts/review-followup.ts write first, so ORIGINAL_TASK_PATTERN in
// review-followup.ts is unaffected.
const META_COMMENT_PATTERN = /<!-- szumrak-meta:(.*?) -->/;
const RUN_INFO_SECTION_PATTERN = /\n---\n\*\*Szumrak run info\*\*[\s\S]*?(?=\n<!-- szumrak-meta:|$)/;

export function parseSzumrakMeta(prBody: string): SzumrakMeta | undefined {
  const match = prBody.match(META_COMMENT_PATTERN);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[1]) as Partial<SzumrakMeta>;
    if (!Array.isArray(parsed.rounds)) {
      return undefined;
    }
    return { v: 1, totalCostUsd: parsed.totalCostUsd, rounds: parsed.rounds };
  } catch (err) {
    log("szumrak_meta_invalid", { error: String(err) });
    return undefined;
  }
}

function formatCost(costUsd: number | undefined): string {
  return costUsd === undefined ? "n/a" : `$${costUsd.toFixed(2)}`;
}

function buildRunInfoSection(meta: SzumrakMeta): string {
  const rows = meta.rounds
    .map((round) => {
      const label = round.round === 0 ? "0 (initial)" : String(round.round);
      return `| ${label} | ${formatCost(round.costUsd)} | ${round.numTurns ?? "n/a"} |`;
    })
    .join("\n");

  return [
    "",
    "---",
    "**Szumrak run info**",
    "",
    "| Round | Cost (USD) | Turns |",
    "|---|---|---|",
    rows,
    "",
    `**Total cost:** ${formatCost(meta.totalCostUsd)}`
  ].join("\n");
}

export interface RoundRunInfo {
  totalCostUsd?: number;
  numTurns?: number;
}

// Appends/refreshes both a human-readable cost/round table (visible in the
// rendered PR, so a reviewer can see at a glance how much each round cost)
// and the trailing szumrak-meta comment carrying the same data as JSON. Both
// are stripped and rebuilt from scratch each call, so there's never more than
// one of each in the body.
export function appendRunInfo(
  prBody: string,
  previousMeta: SzumrakMeta | undefined,
  round: number,
  result: RoundRunInfo
): string {
  const withoutOldSection = prBody.replace(RUN_INFO_SECTION_PATTERN, "").replace(META_COMMENT_PATTERN, "").trimEnd();

  const rounds: Array<RunInfoRound> = [
    ...(previousMeta?.rounds ?? []),
    { round, costUsd: result.totalCostUsd, numTurns: result.numTurns }
  ];
  const totalCostUsd = rounds.some((r) => r.costUsd !== undefined)
    ? rounds.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
    : undefined;

  const meta: SzumrakMeta = { v: 1, totalCostUsd, rounds };

  return `${withoutOldSection}${buildRunInfoSection(meta)}\n\n<!-- szumrak-meta:${JSON.stringify(meta)} -->`;
}
