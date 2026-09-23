import { AgentAuthMethod, resolveAgentAuth } from "~/agent/agent-auth";

const OAUTH_TOKEN = "sk-ant-oat01-test-token";
const API_KEY = "sk-ant-api03-test-key";

/**
 * Keys are restored one by one: `env` holds the original `process.env` object
 * (see platform/env.ts runtimeEnv), so reassigning `process.env` would detach it.
 */
const TOUCHED_KEYS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "SZUMRAK_TEST_PASSTHROUGH"] as const;

describe("resolveAgentAuth", () => {
  const originalValues = Object.fromEntries(TOUCHED_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    for (const key of TOUCHED_KEYS) {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key];
      }
    }
  });

  test("uses the OAuth token and strips the API key when both are set", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = API_KEY;

    const auth = resolveAgentAuth();

    expect(auth.method).toBe(AgentAuthMethod.OAUTH_TOKEN);
    expect(auth.subprocessEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH_TOKEN);
    expect(auth.subprocessEnv).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  test("uses the OAuth token when it is the only credential", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH_TOKEN;

    const auth = resolveAgentAuth();

    expect(auth.method).toBe(AgentAuthMethod.OAUTH_TOKEN);
    expect(auth.subprocessEnv).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  test("falls back to the API key and strips the OAuth token variable", () => {
    process.env.ANTHROPIC_API_KEY = API_KEY;

    const auth = resolveAgentAuth();

    expect(auth.method).toBe(AgentAuthMethod.API_KEY);
    expect(auth.subprocessEnv.ANTHROPIC_API_KEY).toBe(API_KEY);
    expect(auth.subprocessEnv).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });

  test("keeps the rest of the environment for the SDK subprocess", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH_TOKEN;
    process.env.SZUMRAK_TEST_PASSTHROUGH = "kept";

    const auth = resolveAgentAuth();

    expect(auth.subprocessEnv.SZUMRAK_TEST_PASSTHROUGH).toBe("kept");
    expect(auth.subprocessEnv.PATH).toBe(process.env.PATH);
  });

  test("does not mutate process.env itself", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = API_KEY;

    resolveAgentAuth();

    expect(process.env.ANTHROPIC_API_KEY).toBe(API_KEY);
  });
});
