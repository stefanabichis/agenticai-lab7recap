// src/tema4-livrari/agent.ts
//
// AGENTIC — high-level `createAgent`. The model decides itself whether to
// call a tool, which one, and how many times. This is what makes the
// three-call chain work:
//   "Coletul 12345 unde e, și pot să-l redirecționez la un punct din Cluj?"
//   1. trackParcel("12345")           -> status + destination city
//   2. findPickupPoint("Cluj")        -> valid pickup point names there
//   3. changeDelivery("12345", <one of those names>) -> IRREVERSIBLE change
// The pipeline variants can't do this — they run a fixed number of steps
// and never call the irreversible tool at all (see pipeline.ts).

import "dotenv/config";
import { createAgent } from "langchain";
import { deliveryTools } from "./tools.js";

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",
  tools: deliveryTools,
  systemPrompt:
    "You are a delivery/courier assistant. Use the tools to answer " +
    "questions about parcels and pickup points. changeDelivery is " +
    "irreversible: only call it once you've confirmed the parcel's status " +
    "with trackParcel and the exact pickup point name with " +
    "findPickupPoint, and the user has actually asked for the redirect. " +
    "Answer briefly and to the point.",
});

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Coletul 12345 unde e, și pot să-l redirecționez la un punct din Cluj?";
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
// Test „lucru degeaba": `npm run tema4:agent -- "Cât costă livrarea în
// Germania?"`. Niciun tool de aici nu calculează costuri de livrare
// internațională. Agentul, spre deosebire de pipeline.ts, NU e obligat să
// cheme trackParcel doar ca să completeze un pas fix — poate răspunde
// direct că nu are acces la acea informație, fără niciun apel degeaba, și
// mai important, fără să riște vreodată să cheme changeDelivery degeaba
// (tool-ul ireversibil).
// ─────────────────────────────────────────────────────────────────────────
