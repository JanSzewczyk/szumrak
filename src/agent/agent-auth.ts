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
 * What the Claude Code subprocess (and therefore every Bash command and hook
 * the agent runs) needs from the host environment: process basics, locale,
 * proxy/CA settings, and the Windows essentials for local Level 1 runs.
 */
const PASSTHROUGH_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ANTHROPIC_BASE_URL",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "ProgramData",
  "ProgramFiles"
]);

const PASSTHROUGH_PREFIXES = ["LC_"];

function isPassthroughVar(name: string): boolean {
  return PASSTHROUGH_VARS.has(name) || PASSTHROUGH_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Picks exactly one credential for the Claude Code subprocess the SDK spawns.
 * `CLAUDE_CODE_OAUTH_TOKEN` (subscription) wins over `ANTHROPIC_API_KEY` —
 * Claude Code itself prefers the API key when both are present, so only the
 * winning variable is ever passed.
 *
 * The SDK's `env` option *replaces* the subprocess environment (sdk.d.ts), so
 * this builds it from an allowlist rather than spreading `process.env`: the
 * agent can print its own environment through Bash, and Szumrak's process
 * holds secrets that must never reach it (GH_APP_PRIVATE_KEY, skill workflow
 * secrets, TASK/REVIEW_FEEDBACK). Anything a run legitimately needs beyond
 * the allowlist is added explicitly by the caller (see RunAgentOptions.env).
 */
export function resolveAgentAuth(): AgentAuth {
  const subprocessEnv: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => isPassthroughVar(name))
  );

  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    subprocessEnv.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
    return { method: AgentAuthMethod.OAUTH_TOKEN, subprocessEnv };
  }

  subprocessEnv.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  return { method: AgentAuthMethod.API_KEY, subprocessEnv };
}
