import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "~/env";

const appAuthOptions = {
  appId: env.GH_APP_ID as string,
  privateKey: env.GH_APP_PRIVATE_KEY as string,
  installationId: env.GH_APP_INSTALLATION_ID as number
};

// createAppAuth handles the JWT -> installation token exchange (and refresh)
// transparently for every Octokit request; no manual token lifecycle code
// needed here.
export const octokit = new Octokit({ authStrategy: createAppAuth, auth: appAuthOptions });

// git.ts needs the raw token string to embed in a git remote URL for `git
// push`, which Octokit's internal auth strategy doesn't expose. Uses a
// separate createAppAuth instance/cache from the one above — one extra
// lightweight token fetch per run is not worth sharing state over.
const appAuth = createAppAuth(appAuthOptions);

export async function getInstallationToken(): Promise<string> {
  const { token } = await appAuth({ type: "installation" });
  return token;
}
