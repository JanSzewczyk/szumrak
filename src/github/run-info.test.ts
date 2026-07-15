import { appendRunInfo, parseSzumrakMeta } from "~/github/run-info";

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const BASE_BODY = "Task:\nAdd a test\n\nGenerated automatically by Szumrak.\n\nModel summary:\ndone";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseSzumrakMeta", () => {
  test("returns undefined when there is no szumrak-meta comment", () => {
    expect(parseSzumrakMeta(BASE_BODY)).toBeUndefined();
  });

  test("returns undefined without throwing when the comment's JSON is malformed", () => {
    expect(parseSzumrakMeta(`${BASE_BODY}\n\n<!-- szumrak-meta:not-json -->`)).toBeUndefined();
  });

  test("returns undefined when the parsed JSON has no rounds array", () => {
    const body = `${BASE_BODY}\n\n<!-- szumrak-meta:{"v":1,"totalCostUsd":0.5} -->`;
    expect(parseSzumrakMeta(body)).toBeUndefined();
  });

  test("returns the parsed meta when valid", () => {
    const body = `${BASE_BODY}\n\n<!-- szumrak-meta:{"v":1,"totalCostUsd":0.5,"rounds":[{"round":0,"costUsd":0.5,"numTurns":4}]} -->`;
    expect(parseSzumrakMeta(body)).toEqual({
      v: 1,
      totalCostUsd: 0.5,
      rounds: [{ round: 0, costUsd: 0.5, numTurns: 4 }]
    });
  });
});

describe("appendRunInfo", () => {
  test("appends a visible run-info table and a szumrak-meta comment for the first round", () => {
    const body = appendRunInfo(BASE_BODY, undefined, 0, {
      totalCostUsd: 0.41,
      numTurns: 5
    });

    expect(body).toContain("**Szumrak run info**");
    expect(body).toContain("| 0 (initial) | $0.41 | 5 |");
    expect(body).toContain("**Total cost:** $0.41");
    expect(body).toContain('"totalCostUsd":0.41');
    expect(body.startsWith(BASE_BODY.split("\n\nModel summary")[0])).toBe(true);
  });

  test("accumulates rounds and sums totalCostUsd when previousMeta is given", () => {
    const bodyAfterRound0 = appendRunInfo(BASE_BODY, undefined, 0, {
      totalCostUsd: 0.41,
      numTurns: 5
    });
    const meta = parseSzumrakMeta(bodyAfterRound0);

    const bodyAfterRound1 = appendRunInfo(bodyAfterRound0, meta, 1, {
      totalCostUsd: 0.23,
      numTurns: 3
    });

    expect(bodyAfterRound1).toContain("| 0 (initial) | $0.41 | 5 |");
    expect(bodyAfterRound1).toContain("| 1 | $0.23 | 3 |");
    expect(bodyAfterRound1).toContain("**Total cost:** $0.64");

    /** Only one table and one comment survive, not one per round. */
    expect(bodyAfterRound1.match(/\*\*Szumrak run info\*\*/g)).toHaveLength(1);
    expect(bodyAfterRound1.match(/<!-- szumrak-meta:/g)).toHaveLength(1);
  });

  test("renders missing cost/turns as n/a instead of undefined", () => {
    const body = appendRunInfo(BASE_BODY, undefined, 0, {});

    expect(body).toContain("| 0 (initial) | n/a | n/a |");
    expect(body).toContain("**Total cost:** n/a");
  });
});
