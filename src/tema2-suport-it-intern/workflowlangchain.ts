// src/tema2-suport-it-intern/workflowlangchain.ts
//
// AGENTIC — same idea as workflow.ts (model decides which tools to call and
// in what order), but written as a manual loop with plain LangChain instead
// of a LangGraph graph: invoke model -> if it asked for tools, run them and
// feed the results back -> repeat, until the model answers with no tool call.

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { supportTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  supportTools,
);

// Name→tool index, so we can quickly find the tool the model requested.
const toolByName: Record<string, StructuredToolInterface> = Object.fromEntries(
  supportTools.map((t) => [t.name, t]),
);

async function run(question: string): Promise<string> {
  const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
    new SystemMessage(
      "You are an internal IT support assistant. Use the tools to answer " +
        "questions about tickets and service status. Answer briefly.",
    ),
    new HumanMessage(question),
  ];

  // Manual tool-calling loop: the model asks, we execute, we send back.
  for (let turn = 0; turn < 5; turn++) {
    console.log(`\n--- turn ${turn + 1} ---`);
    const res = (await model.invoke(messages)) as AIMessage;
    messages.push(res);

    const toolCalls = res.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log("  no tool calls -> final answer");
      return typeof res.content === "string"
        ? res.content
        : JSON.stringify(res.content);
    }

    console.log(`  ${toolCalls.length} tool call(s) requested`);
    for (const call of toolCalls) {
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

  return "Reached the step limit without a final answer.";
}

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "De ce nu avansează tichetul SD-1042, e ceva căzut?";
  console.log(`\n> Question: ${question}\n`);
  console.log(`< Answer:   ${await run(question)}\n`);
}

main().catch(console.error);
