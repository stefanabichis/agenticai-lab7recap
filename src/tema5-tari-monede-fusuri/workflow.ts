// src/tema5-tari-monede-fusuri/workflow.ts
//
// AGENTIC — same tool-calling loop as agent.ts, but built explicitly as a
// LangGraph StateGraph instead of the high-level createAgent wrapper.
// The graph has two nodes ("agent" and "tools") and loops between them for
// as long as the model keeps requesting tools — the model decides the path,
// not us. This is the strict-dependency chain in action:
//   turn 1: model calls countryInfo("Japonia")
//   turn 2: model calls convertCurrency(500, "RON", "JPY") using the JPY
//           code it just read from the countryInfo result
//   turn 3: model calls localTime("Asia/Tokyo") using the timezone it read
//           from the SAME countryInfo result
//   turn 4: model composes the final answer.
// callModel logs every tool call in order, so the console output IS the
// audit trail for "did it call countryInfo first, every time".

import "dotenv/config";
import {
  StateGraph,
  START,
  END,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { countryTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  countryTools,
);

// Prebuilt node that executes whatever tools the model requested.
const toolNode = new ToolNode(countryTools);

// Order tool calls happened in, across the whole run.
const callOrder: string[] = [];

// Called by the "agent" node in the graph.
async function callModel(s: typeof MessagesAnnotation.State) {
  const res = await model.invoke(s.messages);
  console.log(`  model responded with: ${JSON.stringify(res.content)}`);

  for (const call of res.tool_calls ?? []) {
    console.log(`  → ${call.name}(${JSON.stringify(call.args)})`);
    callOrder.push(call.name);
  }
  return { messages: [res] };
}

// Loop back to the tools node while the model keeps requesting tools.
function shouldContinue(s: typeof MessagesAnnotation.State) {
  const last = s.messages[s.messages.length - 1] as AIMessage;
  return last.tool_calls?.length ? "tools" : END;
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, ["tools", END])
  .addEdge("tools", "agent")
  .compile();

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Dacă am 500 de lei, cât fac în moneda Japoniei, și cât e ceasul acolo?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke(
    {
      messages: [
        new SystemMessage(
          "You are a travel/finance assistant. Use the tools to answer " +
            "questions about countries, currency conversion, and local " +
            "time. Always call countryInfo first when you need a " +
            "country's currency code or timezone — never guess them. " +
            "Answer briefly.",
        ),
        new HumanMessage(question),
      ],
    },
    { recursionLimit: 25 },
  );

  const last = result.messages[result.messages.length - 1];
  console.log(`< Answer: ${last.content}\n`);
  console.log(`(total messages in the graph: ${result.messages.length})`);
  console.log(`(tool call order: ${callOrder.join(" -> ") || "(none)"})`);
  console.log(
    `(skipped countryInfo first? ${callOrder.length > 0 && callOrder[0] !== "countryInfo" ? "YES — model tried to guess before looking up the country" : "no"})`,
  );
}

main().catch(console.error);
