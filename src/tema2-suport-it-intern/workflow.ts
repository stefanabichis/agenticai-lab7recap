// src/tema2-suport-it-intern/workflow.ts
//
// AGENTIC — same tool-calling loop as agent.ts, but built explicitly as a
// LangGraph StateGraph instead of the high-level createAgent wrapper.
// The graph has two nodes ("agent" and "tools") and loops between them for
// as long as the model keeps requesting tools — the model decides the path,
// not us. This is what lets a chained question work:
//   "De ce nu avansează tichetul SD-1042, e ceva căzut?"
//   turn 1: model calls findTicket("SD-1042")
//   turn 2: model reads the affected service (VPN) from the result, calls
//           serviceStatus("VPN")
//   turn 3: model composes the final answer.

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
import { supportTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  supportTools,
);

// Prebuilt node that executes whatever tools the model requested.
const toolNode = new ToolNode(supportTools);

// Called by the "agent" node in the graph.
async function callModel(s: typeof MessagesAnnotation.State) {
  const res = await model.invoke(s.messages);
  console.log(`  model responded with: ${JSON.stringify(res.content)}`);

  for (const call of res.tool_calls ?? []) {
    console.log(`  → ${call.name}(${JSON.stringify(call.args)})`);
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
    "De ce nu avansează tichetul SD-1042, e ceva căzut?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke(
    {
      messages: [
        new SystemMessage(
          "You are an internal IT support assistant. Use the tools to " +
            "answer questions about tickets and service status. Answer " +
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
}

main().catch(console.error);
