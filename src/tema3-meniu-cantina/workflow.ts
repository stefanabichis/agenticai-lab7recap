// src/tema3-meniu-cantina/workflow.ts
//
// AGENTIC — same tool-calling loop as agent.ts, but built explicitly as a
// LangGraph StateGraph instead of the high-level createAgent wrapper.
// The graph has two nodes ("agent" and "tools") and loops between them for
// as long as the model keeps requesting tools — the model decides the path,
// not us. This is what lets the menu-size-dependent case work:
//   "Ce pot mânca dacă am alergie la lactoză?"
//   turn 1: model calls todayMenu()
//   turns 2..N+1: model calls dishAllergens(id) once per dish returned
//   turn N+2: model composes the final answer.
// callModel logs every tool call as it happens, so you can literally count
// how many dishAllergens calls were made and check it matches the menu size.

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
import { canteenTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  canteenTools,
);

// Prebuilt node that executes whatever tools the model requested.
const toolNode = new ToolNode(canteenTools);

// Tally of tool calls across the whole run, printed at the end so it's easy
// to check "N dishes on the menu -> N dishAllergens calls".
const toolCallCounts: Record<string, number> = {};

// Called by the "agent" node in the graph.
async function callModel(s: typeof MessagesAnnotation.State) {
  const res = await model.invoke(s.messages);
  console.log(`  model responded with: ${JSON.stringify(res.content)}`);

  for (const call of res.tool_calls ?? []) {
    console.log(`  → ${call.name}(${JSON.stringify(call.args)})`);
    toolCallCounts[call.name] = (toolCallCounts[call.name] ?? 0) + 1;
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
    "Ce pot mânca dacă am alergie la lactoză?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke(
    {
      messages: [
        new SystemMessage(
          "You are a canteen assistant. Use the tools to answer " +
            "questions about today's menu, allergens, and prices. Answer " +
            "briefly.",
        ),
        new HumanMessage(question),
      ],
    },
    { recursionLimit: 25 },
  );

  const last = result.messages[result.messages.length - 1];
  console.log(`< Answer: ${last.content}\n`);
  console.log(`(total messages in the graph: ${result.messages.length})`);
  console.log(`(tool calls made: ${JSON.stringify(toolCallCounts)})`);
}

main().catch(console.error);
