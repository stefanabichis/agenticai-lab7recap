// src/tema3-meniu-cantina/workflowlangchain.ts
//
// AGENTIC — same idea as workflow.ts (model decides which tools to call and
// in what order), but written as a manual loop with plain LangChain instead
// of a LangGraph graph: invoke model -> if it asked for tools, run them and
// feed the results back -> repeat, until the model answers with no tool call.
// Same tally of tool calls as workflow.ts, printed at the end.

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { canteenTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  canteenTools,
);

// Name→tool index, so we can quickly find the tool the model requested.
const toolByName: Record<string, StructuredToolInterface> = Object.fromEntries(
  canteenTools.map((t) => [t.name, t]),
);

async function run(
  question: string,
): Promise<{ answer: string; toolCallCounts: Record<string, number> }> {
  const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
    new SystemMessage(
      "You are a canteen assistant. Use the tools to answer questions " +
        "about today's menu, allergens, and prices. Answer briefly.",
    ),
    new HumanMessage(question),
  ];

  const toolCallCounts: Record<string, number> = {};

  // Manual tool-calling loop: the model asks, we execute, we send back.
  for (let turn = 0; turn < 10; turn++) {
    console.log(`\n--- turn ${turn + 1} ---`);
    const res = (await model.invoke(messages)) as AIMessage;
    messages.push(res);

    const toolCalls = res.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log("  no tool calls -> final answer");
      const answer =
        typeof res.content === "string"
          ? res.content
          : JSON.stringify(res.content);
      return { answer, toolCallCounts };
    }

    console.log(`  ${toolCalls.length} tool call(s) requested`);
    for (const call of toolCalls) {
      toolCallCounts[call.name] = (toolCallCounts[call.name] ?? 0) + 1;
      const tool = toolByName[call.name];
      const result = tool
        ? ((await tool.invoke(call.args)) as string)
        : `Unknown tool: ${call.name}`;
      console.log(`  → ${call.name}(${JSON.stringify(call.args)}) = ${result}`);
      messages.push(
        new ToolMessage({ content: result, tool_call_id: call.id! }),
      );
    }
  }

  return {
    answer: "Reached the step limit without a final answer.",
    toolCallCounts,
  };
}

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Ce pot mânca dacă am alergie la lactoză?";
  console.log(`\n> Question: ${question}\n`);

  const { answer, toolCallCounts } = await run(question);
  console.log(`< Answer:   ${answer}\n`);
  console.log(`(tool calls made: ${JSON.stringify(toolCallCounts)})`);
}

main().catch(console.error);
