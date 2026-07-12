import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { log } from "./logger.js";

export interface AgentToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentRunResult {
  toolCalls: AgentToolCall[];
  finalMessage: string;
  succeeded: boolean;
  totalCostUsd?: number;
}

// Agent edytuje pliki przez wbudowane narzędzia SDK (Read/Edit/Grep/Glob/Skill).
// Commit/push/PR wykonuje osobno git.ts po zakończeniu runu — agent nigdy sam
// nie wywołuje `git push`/`gh pr create`, więc permissionMode "acceptEdits"
// (auto-akceptacja edycji plików) wystarcza bez rozszerzania o Bash.
export async function runAgent(task: string): Promise<AgentRunResult> {
  const toolCalls: AgentToolCall[] = [];
  let finalMessage = "";
  let succeeded = false;
  let totalCostUsd: number | undefined;
  const startedAt = Date.now();

  log("agent_start", { task });

  const stream = query({
    prompt: task,
    options: {
      cwd: config.workspacePath,
      permissionMode: "acceptEdits",
      maxTurns: config.maxTurns,
      skills: "all",
    },
  });

  for await (const message of stream) {
    log("agent_message", { type: message.type });

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const toolCall = { name: block.name, input: block.input as Record<string, unknown> };
          toolCalls.push(toolCall);
          log("tool_call", toolCall);
        }
        if (block.type === "text") {
          finalMessage = block.text;
        }
      }
    }

    if (message.type === "result") {
      succeeded = message.subtype === "success" && !message.is_error;
      totalCostUsd = message.total_cost_usd;
      if ("result" in message && typeof message.result === "string") {
        finalMessage = message.result;
      }
      log("agent_result", {
        subtype: message.subtype,
        isError: message.is_error,
        totalCostUsd: message.total_cost_usd,
        numTurns: message.num_turns,
      });
    }

    if (Date.now() - startedAt > config.maxDurationMs) {
      log("agent_timeout", { elapsedMs: Date.now() - startedAt });
      throw new Error("Agent exceeded max duration");
    }
  }

  log("agent_end", { toolCallCount: toolCalls.length, succeeded });

  return { toolCalls, finalMessage, succeeded, totalCostUsd };
}
