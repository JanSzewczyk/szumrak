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
// 6. Strings matching known secret patterns (sk-ant-, AKIA, ghp_, PEM private key
//    blocks, etc.) are replaced with "[REDACTED]", including when nested inside
//    arrays/objects.
// 7. Strings longer than the length cap are truncated with a "[truncated, N chars
//    total]" suffix instead of being logged in full (e.g. a Write tool's file content).
// 8. Short strings and non-string values (numbers, booleans, null) pass through
//    unchanged.

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

    test.each([
      ["Anthropic key", "sk-ant-api03-abc123def456ghi789"],
      ["AWS access key", "AKIAABCDEFGHIJKLMNOP"],
      ["GitHub PAT (classic prefix)", "ghp_abcdefghijklmnopqrstuvwxyz012345678"],
      ["GitHub fine-grained PAT", "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123456789"],
      ["Google API key", "AIzaSyAbcdefghijklmnopqrstuvwxyz012345"],
      ["Slack token", ["xoxb", "1234567890", "abcdefghijklmnop"].join("-")],
      ["PEM private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----"]
    ])("redacts a %s found anywhere in the logged data", async (_label, secret) => {
      const { log } = await import("~/lib/logger");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      log("tool_call", { input: { nested: [{ content: `before ${secret} after` }] } });

      const written = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(JSON.stringify(written)).not.toContain(secret);
      expect(written.input.nested[0].content).toBe("before [REDACTED] after");

      consoleSpy.mockRestore();
    });

    test("truncates strings longer than the length cap instead of logging full file content", async () => {
      const { log } = await import("~/lib/logger");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const fullFileContent = "x".repeat(1000);

      log("tool_call", { input: { file_path: "src/foo.ts", content: fullFileContent } });

      const written = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(written.input.file_path).toBe("src/foo.ts");
      expect(written.input.content).toBe(`${"x".repeat(500)}... [truncated, 1000 chars total]`);

      consoleSpy.mockRestore();
    });

    test("leaves short strings and non-string values unchanged", async () => {
      const { log } = await import("~/lib/logger");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      log("tool_call", { input: { path: "src/foo.ts", count: 3, ok: true, missing: null } });

      const written = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(written.input).toEqual({ path: "src/foo.ts", count: 3, ok: true, missing: null });

      consoleSpy.mockRestore();
    });
  });
});
