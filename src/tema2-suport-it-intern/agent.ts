// src/tema2-suport-it-intern/agent.ts
//
// AGENTIC — high-level `createAgent`. The model decides itself whether to
// call a tool, which one, and how many times. This is what makes the
// "second call depends on the first" case work:
//   "De ce nu avansează tichetul SD-1042, e ceva căzut?"
//   -> model calls findTicket("SD-1042"), reads the affected service (VPN)
//      from the result, THEN calls serviceStatus("VPN") to see if that
//      explains the stall. The pipeline variants can't do this — they run
//      a fixed number of steps in a fixed order.

import "dotenv/config";
import { createAgent } from "langchain";
import { supportTools } from "./tools.js";

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",
  tools: supportTools,
  systemPrompt:
    "You are an internal IT support assistant. Use the tools to answer " +
    "questions about tickets and service status. Answer briefly and to " +
    "the point.",
});

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "De ce nu avansează tichetul SD-1042, e ceva căzut?";
  console.log(`\n> Question: ${question}\n`);

  const result = await agent.invoke(
    { messages: [{ role: "user", content: question }] },
    { recursionLimit: 25 },
  );

  const lastMessage = result.messages[result.messages.length - 1];
  console.log(`< Answer: ${lastMessage.content}\n`);
  console.log(`(total messages in the loop: ${result.messages.length})`);
}

main().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────
// Test „lucru degeaba": `npm run tema2:agent -- "Câte zile de concediu mai
// am?"`. Niciun tool de aici nu are de-a face cu concediul. Agentul, spre
// deosebire de pipeline.ts, NU e obligat să cheme findTicket doar ca să
// completeze un pas fix — poate răspunde direct că nu are acces la acea
// informație, fără niciun apel degeaba.
// ─────────────────────────────────────────────────────────────────────────
