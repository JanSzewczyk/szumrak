import { env } from "~/platform/env";

export const AgentAuthMethod = {
  OAUTH_TOKEN: "oauth-token",
  API_KEY: "api-key"
} as const;

export type AgentAuthMethod = (typeof AgentAuthMethod)[keyof typeof AgentAuthMethod];

export type AgentAuth = {
  method: AgentAuthMethod;
  subprocessEnv: Record<string, string | undefined>;
};

/**
 * Picks exactly one credential for the Claude Code subprocess the SDK spawns.
 * `CLAUDE_CODE_OAUTH_TOKEN` (subscription) wins over `ANTHROPIC_API_KEY` —
 * but Claude Code itself prefers the API key when both are present, so the
 * losing variable is removed from the subprocess environment rather than
 * merely ignored here.
 *
 * Spreading `process.env` is deliberate: the SDK's `env` option *replaces*
 * the subprocess environment (sdk.d.ts), so PATH/HOME/etc. must be copied
 * along. The credential choice itself is still read through validated `env`.
 */
export function resolveAgentAuth(): AgentAuth {
  const subprocessEnv: Record<string, string | undefined> = { ...process.env };

  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    delete subprocessEnv.ANTHROPIC_API_KEY;
    return { method: AgentAuthMethod.OAUTH_TOKEN, subprocessEnv };
  }

  delete subprocessEnv.CLAUDE_CODE_OAUTH_TOKEN;
  return { method: AgentAuthMethod.API_KEY, subprocessEnv };
}
