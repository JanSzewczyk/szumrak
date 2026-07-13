// Test plan for src/lib/logger.ts
// 1. log() writes a JSON line to console.log with ts/event/data merged in.
// 2. log() calls appendFileSync with the derived LOG_PATH and a trailing newline.
// 3. log() defaults `data` to {} when omitted, still producing valid JSON.
// 4. log() swallows appendFileSync errors (try/catch) — console.log must still fire
//    and the function must not throw.
// 5. LOG_PATH is derived from env.AGENT_LOG_PATH when set (module-load-time behavior),
//    otherwise falls back to join(env.WORKSPACE_PATH, "agent-run.jsonl"). Verified via
//    two isolated module loads (vi.resetModules + dynamic import) since LOG_PATH is
//    computed once at import time.

import { appendFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn()
}));

describe("logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("log", () => {
    test("writes a JSON line to console.log containing timestamp, event and data", async () => {
      const { log } = await import("~/lib/logger");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      log("agent_start", { task: "do the thing" });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const written = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(written).toMatchObject({ event: "agent_start", task: "do the thing" });
      expect(typeof written.ts).toBe("string");
      expect(new Date(written.ts).toISOString()).toBe(written.ts);

      consoleSpy.mockRestore();
    });

    test("defaults data to an empty object when omitted", async () => {
      const { log } = await import("~/lib/logger");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      log("no_changes");

      const written = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(written).toEqual({ ts: written.ts, event: "no_changes" });

      consoleSpy.mockRestore();
    });

    test("appends the same entry (plus newline) to the log file at the derived LOG_PATH", async () => {
      process.env.WORKSPACE_PATH = "/workspace";
      delete process.env.AGENT_LOG_PATH;
      vi.resetModules();
      const { log } = await import("~/lib/logger");
      vi.spyOn(console, "log").mockImplementation(() => {});

      log("git", { args: ["status"] });

      expect(appendFileSync).toHaveBeenCalledTimes(1);
      const [path, contents] = vi.mocked(appendFileSync).mock.calls.at(0) ?? [];
      expect(path).toBe(join("/workspace", "agent-run.jsonl"));
      expect(contents).toMatch(/\n$/);
      expect(JSON.parse((contents as string).trim())).toMatchObject({ event: "git", args: ["status"] });
    });

    test("uses env.AGENT_LOG_PATH instead of the workspace default when set", async () => {
      process.env.WORKSPACE_PATH = "/workspace";
      process.env.AGENT_LOG_PATH = "/custom/run.jsonl";
      vi.resetModules();
      const { log } = await import("~/lib/logger");
      vi.spyOn(console, "log").mockImplementation(() => {});

      log("agent_end");

      const [path] = vi.mocked(appendFileSync).mock.calls.at(0) ?? [];
      expect(path).toBe("/custom/run.jsonl");

      delete process.env.AGENT_LOG_PATH;
    });

    test("swallows appendFileSync errors without throwing and still logs to console", async () => {
      vi.resetModules();
      vi.mocked(appendFileSync).mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });
      const { log } = await import("~/lib/logger");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      expect(() => log("agent_end", { succeeded: true })).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });
  });
});
