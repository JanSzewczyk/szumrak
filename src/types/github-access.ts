export const GitHubAccess = {
  READ: "read",
  WRITE: "write"
} as const;

export type GitHubAccess = (typeof GitHubAccess)[keyof typeof GitHubAccess];

/** The subset of GitHub App installation permissions a skill workflow may request for its agent token. */
export type ScopedTokenPermissions = {
  contents?: GitHubAccess;
  pull_requests?: GitHubAccess;
  issues?: GitHubAccess;
  workflows?: GitHubAccess;
};
