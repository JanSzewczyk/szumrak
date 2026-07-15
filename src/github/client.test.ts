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
    const { octokit } = await import("~/github/client");

    expect(octokit).toBeInstanceOf(Octokit);
  });

  test("exposes the REST namespaces used by github/git-operations.ts", async () => {
    vi.resetModules();
    const { octokit } = await import("~/github/client");

    expect(octokit.pulls.create).toBeTypeOf("function");
    expect(octokit.issues.addLabels).toBeTypeOf("function");
  });

  test("constructs the App auth strategy with credentials from env", async () => {
    vi.resetModules();

    await import("~/github/client");

    expect(mockedCreateAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "123456", installationId: "789" })
    );
  });

  test("getInstallationToken resolves the raw token string", async () => {
    vi.resetModules();
    const { getInstallationToken } = await import("~/github/client");

    const token = await getInstallationToken();

    expect(token).toBe("ghs_fake-installation-token");
  });
});
