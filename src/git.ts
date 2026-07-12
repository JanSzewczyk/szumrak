import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import { log } from "./logger.js";

function sh(cmd: string): string {
  log("shell", { cmd });
  return execSync(cmd, { cwd: config.workspacePath, encoding: "utf-8" });
}

export async function commitAndOpenPR(taskSummary: string, body: string): Promise<string | null> {
  const branch = `${config.branchPrefix}${Date.now()}`;

  sh(`git checkout -b ${branch}`);

  const status = sh("git status --porcelain");
  if (!status.trim()) {
    log("no_changes");
    return null;
  }

  sh("git add -A");
  sh(`git commit -m "chore(agent): ${taskSummary.slice(0, 72).replace(/"/g, "'")}"`);
  sh(`git push origin ${branch}`);

  const [owner, repo] = (process.env.REPO ?? "").split("/");
  if (!owner || !repo) {
    throw new Error("Zmienna REPO musi mieć format 'owner/repo'");
  }

  const octokit = new Octokit({ auth: process.env.GH_TOKEN });

  const pr = await octokit.pulls.create({
    owner,
    repo,
    title: `[agent] ${taskSummary.slice(0, 72)}`,
    body,
    head: branch,
    base: "main",
  });

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: pr.data.number,
    labels: ["ai-generated"],
  });

  log("pr_created", { url: pr.data.html_url });
  return pr.data.html_url;
}
