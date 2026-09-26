import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "~/platform/env";
import type { ScopedTokenPermissions } from "~/types/github-access";

const appAuthOptions = {
  appId: env.GH_APP_ID as string,
  privateKey: env.GH_APP_PRIVATE_KEY as string,
  installationId: env.GH_APP_INSTALLATION_ID as number
};

/**
 * `createAppAuth` handles the JWT -> installation token exchange (and
 * refresh) transparently for every Octokit request; no manual token
 * lifecycle code needed here.
 */
export const octokit = new Octokit({ authStrategy: createAppAuth, auth: appAuthOptions });

/**
 * Separate createAppAuth instance/cache from the one above — one extra
 * lightweight token fetch per run is not worth sharing state over.
 */
const appAuth = createAppAuth(appAuthOptions);

/**
 * github/git-operations.ts needs the raw token string to embed in a git
 * remote URL for `git push`, which Octokit's internal auth strategy doesn't
 * expose.
 */
export async function getInstallationToken(): Promise<string> {
  const { token } = await appAuth({ type: "installation" });
  return token;
}

/**
 * A token handed to the *agent* (for `gh`/`git push` inside a skill
 * workflow), as opposed to {@link getInstallationToken}'s, which only
 * Szumrak's own Node code uses. GitHub narrows it at creation time to the one
 * target repo and to exactly the permissions the manifest asks for — never
 * wider than the App installation itself — and it expires after an hour, so
 * a leak (the agent can always print its own environment) is bounded in both
 * scope and lifetime. `refresh: true` always mints a new token rather than
 * risking a cached, unscoped one.
 */
export async function createScopedInstallationToken(
  repo: string,
  permissions: ScopedTokenPermissions
): Promise<string> {
  const { token } = await appAuth({
    type: "installation",
    repositoryNames: [repo],
    permissions,
    refresh: true
  });
  return token;
}
