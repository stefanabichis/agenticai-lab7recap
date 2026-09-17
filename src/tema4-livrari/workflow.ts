// src/tema4-livrari/workflow.ts
//
// AGENTIC — same tool-calling loop as agent.ts, but built explicitly as a
// LangGraph StateGraph instead of the high-level createAgent wrapper.
// The graph has two nodes ("agent" and "tools") and loops between them for
// as long as the model keeps requesting tools — the model decides the path,
// not us. This is what lets the three-call chain work:
//   turn 1: model calls trackParcel("12345")
//   turn 2: model calls findPickupPoint("Cluj") using the destination city
//           it just read from the trackParcel result
//   turn 3: model calls changeDelivery("12345", <exact point name>) — the
//           IRREVERSIBLE call, only reachable after the two checks above
//   turn 4: model composes the final answer.

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
import { deliveryTools } from "./tools.js";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" }).bindTools(
  deliveryTools,
);

// Prebuilt node that executes whatever tools the model requested.
const toolNode = new ToolNode(deliveryTools);

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
    "Coletul 12345 unde e, și pot să-l redirecționez la un punct din Cluj?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke(
    {
      messages: [
        new SystemMessage(
          "You are a delivery/courier assistant. Use the tools to answer " +
            "questions about parcels and pickup points. changeDelivery is " +
            "irreversible: only call it once you've confirmed the " +
            "parcel's status with trackParcel and the exact pickup point " +
            "name with findPickupPoint, and the user has actually asked " +
            "for the redirect. Answer briefly.",
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
