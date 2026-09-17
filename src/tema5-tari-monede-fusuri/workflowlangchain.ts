// src/tema5-tari-monede-fusuri/workflowlangchain.ts
//
// AGENTIC — same idea as workflow.ts (model decides which tools to call and
// in what order), but written as a manual loop with plain LangChain instead
// of a LangGraph graph: invoke model -> if it asked for tools, run them and
// feed the results back -> repeat, until the model answers with no tool call.
// Same call-order log as workflow.ts, printed at the end.

import "dotenv/config";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { countryTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  countryTools,
);

// Name→tool index, so we can quickly find the tool the model requested.
const toolByName: Record<string, StructuredToolInterface> = Object.fromEntries(
  countryTools.map((t) => [t.name, t]),
);

async function run(
  question: string,
): Promise<{ answer: string; callOrder: string[] }> {
  const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
    new SystemMessage(
      "You are a travel/finance assistant. Use the tools to answer " +
        "questions about countries, currency conversion, and local time. " +
        "Always call countryInfo first when you need a country's " +
        "currency code or timezone — never guess them. Answer briefly.",
    ),
    new HumanMessage(question),
  ];

  const callOrder: string[] = [];

  // Manual tool-calling loop: the model asks, we execute, we send back.
  for (let turn = 0; turn < 6; turn++) {
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
      return { answer, callOrder };
    }

    console.log(`  ${toolCalls.length} tool call(s) requested`);
    for (const call of toolCalls) {
      callOrder.push(call.name);
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
    callOrder,
  };
}

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Dacă am 500 de lei, cât fac în moneda Japoniei, și cât e ceasul acolo?";
  console.log(`\n> Question: ${question}\n`);

  const { answer, callOrder } = await run(question);
  console.log(`< Answer:   ${answer}\n`);
  console.log(`(tool call order: ${callOrder.join(" -> ") || "(none)"})`);
  console.log(
    `(skipped countryInfo first? ${callOrder.length > 0 && callOrder[0] !== "countryInfo" ? "YES — model tried to guess before looking up the country" : "no"})`,
  );
}

main().catch(console.error);
