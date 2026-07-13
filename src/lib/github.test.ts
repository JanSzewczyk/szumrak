// Test plan for src/lib/github.ts
// This module is a one-line Octokit instantiation — no branching logic. A smoke test
// confirming it constructs a usable client (auth wired from GH_TOKEN) is sufficient;
// deeper Octokit behavior is the library's own responsibility, not ours to test.
// 1. octokit is exported and is an Octokit instance exposing the REST namespaces
//    (pulls, issues) that src/git.ts relies on.

import { Octokit } from "@octokit/rest";
import { octokit } from "~/lib/github";

describe("github", () => {
  test("exports an Octokit client instance", () => {
    expect(octokit).toBeInstanceOf(Octokit);
  });

  test("exposes the REST namespaces used by git.ts", () => {
    expect(octokit.pulls.create).toBeTypeOf("function");
    expect(octokit.issues.addLabels).toBeTypeOf("function");
  });
});
