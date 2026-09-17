// src/tema3-meniu-cantina/agent.ts
//
// AGENTIC — high-level `createAgent`. The model decides itself whether to
// call a tool, which one, and how many times. This is what the assignment's
// extra requirement is about:
//   "Ce pot mânca dacă am alergie la lactoză?"
//   -> model calls todayMenu() ONCE, reads how many dishes came back (N),
//      THEN calls dishAllergens(id) once PER dish (N calls) to see which
//      ones contain "lactoză". Change the menu's length in tools.ts and
//      this number changes too — the pipeline variants can't do this, they
//      always make exactly one todayMenu call and look at dish [0].

import "dotenv/config";
import { createAgent } from "langchain";
import type { AIMessage } from "@langchain/core/messages";
import { canteenTools } from "./tools.js";

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",
  tools: canteenTools,
  systemPrompt:
    "You are a canteen assistant. Use the tools to answer questions " +
    "about today's menu, allergens, and prices. Answer briefly and to " +
    "the point.",
});

// Count how many times each tool was called, by scanning the AIMessages
// in the final message history for their `tool_calls`. This is how we
// "notăm câte apeluri face agentul" for a createAgent run, since it hides
// the turn-by-turn loop that workflow.ts/workflowlangchain.ts log directly.
function countToolCalls(messages: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of messages as AIMessage[]) {
    for (const call of m.tool_calls ?? []) {
      counts[call.name] = (counts[call.name] ?? 0) + 1;
    }
  }
  return counts;
}

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Ce pot mânca dacă am alergie la lactoză?";
  console.log(`\n> Question: ${question}\n`);

  const result = await agent.invoke(
    { messages: [{ role: "user", content: question }] },
    { recursionLimit: 25 },
  );

  const lastMessage = result.messages[result.messages.length - 1];
  console.log(`< Answer: ${lastMessage.content}\n`);
  console.log(`(total messages in the loop: ${result.messages.length})`);
  console.log(`(tool calls made: ${JSON.stringify(countToolCalls(result.messages))})`);
}

main().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────
// Test „lucru degeaba": `npm run tema3:agent -- "Cât costă un abonament
// lunar?"`. Niciun tool de aici nu are de-a face cu abonamente. Agentul,
// spre deosebire de pipeline.ts, NU e obligat să cheme todayMenu doar ca
// să completeze un pas fix — poate răspunde direct că nu are acces la
// acea informație, fără niciun apel degeaba.
// ─────────────────────────────────────────────────────────────────────────
