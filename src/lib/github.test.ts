// Test plan for src/lib/github.ts
// 1. octokit is exported and is an Octokit instance exposing the REST namespaces
//    (pulls, issues) that src/git.ts relies on.
// 2. octokit is constructed with authStrategy: createAppAuth and the App
//    credentials from env (appId, privateKey, installationId) — this is what
//    makes PRs show up authored by the GitHub App's bot user instead of
//    whoever owns a personal token.
// 3. getInstallationToken() resolves the raw token string via a separate
//    createAppAuth({ type: "installation" }) call — needed by git.ts to embed
//    the token directly in a git remote URL, which Octokit's own auth
//    strategy doesn't expose.

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

vi.mock("@octokit/auth-app", () => {
  const authFn = Object.assign(vi.fn().mockResolvedValue({ type: "token", token: "ghs_fake-installation-token" }), {
    hook: vi.fn()
  });
  return { createAppAuth: vi.fn(() => authFn) };
});

const mockedCreateAppAuth = vi.mocked(createAppAuth);

describe("github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GH_APP_ID = "123456";
    process.env.GH_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";
    process.env.GH_APP_INSTALLATION_ID = "789";
  });

  test("exports an Octokit client instance", async () => {
    vi.resetModules();
    const { octokit } = await import("~/lib/github");

    expect(octokit).toBeInstanceOf(Octokit);
  });

  test("exposes the REST namespaces used by git.ts", async () => {
    vi.resetModules();
    const { octokit } = await import("~/lib/github");

    expect(octokit.pulls.create).toBeTypeOf("function");
    expect(octokit.issues.addLabels).toBeTypeOf("function");
  });

  test("constructs the App auth strategy with credentials from env", async () => {
    vi.resetModules();

    await import("~/lib/github");

    expect(mockedCreateAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "123456", installationId: "789" })
    );
  });

  test("getInstallationToken resolves the raw token string", async () => {
    vi.resetModules();
    const { getInstallationToken } = await import("~/lib/github");

    const token = await getInstallationToken();

    expect(token).toBe("ghs_fake-installation-token");
  });
});
