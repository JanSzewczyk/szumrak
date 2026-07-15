// Shared by pull-requests.ts, the dedup check, and the review-followup flow —
// all need owner/repo split out of REPO ("owner/repo").
export function parseRepo(repo: string | undefined): { owner: string; repo: string } {
  const [owner, name] = (repo ?? "").split("/");
  if (!owner || !name) {
    throw new Error("The REPO environment variable must be in 'owner/repo' format");
  }
  return { owner, repo: name };
}
