import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "./env";
import { log } from "./lib/logger";

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

// The agent edits files through the SDK's built-in tools (Read/Edit/Grep/Glob).
// Commit/push/PR happens separately in git.ts after the run finishes — the agent
// never runs `git push`/`gh pr create` itself, so permissionMode "acceptEdits"
// (auto-accept file edits) is enough without opening up Bash.
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
      cwd: env.WORKSPACE_PATH,
      permissionMode: "acceptEdits",
      maxTurns: env.MAX_TURNS,
      model: env.AGENT_MODEL
    }
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      const textBlocks: string[] = [];
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const toolCall = { name: block.name, input: block.input as Record<string, unknown> };
          toolCalls.push(toolCall);
          log("tool_call", toolCall);
        }
        if (block.type === "text") {
          finalMessage = block.text;
          textBlocks.push(block.text);
        }
      }
      log("agent_message", { type: message.type, text: textBlocks.join("\n") || undefined });
    } else if (message.type === "user") {
      log("agent_message", { type: message.type, content: message.message.content });
    } else {
      log("agent_message", { type: message.type, ...("subtype" in message ? { subtype: message.subtype } : {}) });
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
        result: "result" in message ? message.result : undefined
      });
    }

    if (Date.now() - startedAt > env.MAX_DURATION_MS) {
      log("agent_timeout", { elapsedMs: Date.now() - startedAt });
      throw new Error("Agent exceeded max duration");
    }
  }

  log("agent_end", { toolCallCount: toolCalls.length, succeeded, finalMessage });

  return { toolCalls, finalMessage, succeeded, totalCostUsd };
}
