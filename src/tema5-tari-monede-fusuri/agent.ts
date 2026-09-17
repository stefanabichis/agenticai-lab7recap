// src/tema5-tari-monede-fusuri/agent.ts
//
// AGENTIC — high-level `createAgent`. The model decides itself whether to
// call a tool, which one, and how many times. This is what makes the
// three-call chain work, and it's a STRICT dependency chain (unlike the
// other themes, where re-ordering the calls wouldn't break anything):
//   "Dacă am 500 de lei, cât fac în moneda Japoniei, și cât e ceasul acolo?"
//   1. countryInfo("Japonia")            -> moneda=JPY, fus=Asia/Tokyo
//   2. convertCurrency(500, "RON", "JPY") -> needs the JPY from step 1
//   3. localTime("Asia/Tokyo")            -> needs the fus from step 1
// Steps 2 and 3 are IMPOSSIBLE to do correctly before step 1 returns — the
// model has no other way to learn that Japan's currency is JPY. We log the
// exact order of tool calls below so you can check countryInfo really was
// called first, not guessed around.

import "dotenv/config";
import { createAgent } from "langchain";
import type { AIMessage } from "@langchain/core/messages";
import { countryTools } from "./tools.js";

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",
  tools: countryTools,
  systemPrompt:
    "You are a travel/finance assistant. Use the tools to answer " +
    "questions about countries, currency conversion, and local time. " +
    "Always call countryInfo first when you need a country's currency " +
    "code or timezone — never guess them. Answer briefly.",
});

// Reconstruct the ORDER tool calls happened in, by scanning the AIMessages
// in the final message history. createAgent hides the turn-by-turn loop,
// so this is how we "notăm ordinea" for a createAgent run.
function toolCallOrder(messages: unknown[]): string[] {
  const order: string[] = [];
  for (const m of messages as AIMessage[]) {
    for (const call of m.tool_calls ?? []) {
      order.push(call.name);
    }
  }
  return order;
}

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Dacă am 500 de lei, cât fac în moneda Japoniei, și cât e ceasul acolo?";
  console.log(`\n> Question: ${question}\n`);

  const result = await agent.invoke(
    { messages: [{ role: "user", content: question }] },
    { recursionLimit: 25 },
  );

  const lastMessage = result.messages[result.messages.length - 1];
  const order = toolCallOrder(result.messages);
  console.log(`< Answer: ${lastMessage.content}\n`);
  console.log(`(total messages in the loop: ${result.messages.length})`);
  console.log(`(tool call order: ${order.join(" -> ") || "(none)"})`);
  console.log(
    `(skipped countryInfo first? ${order.length > 0 && order[0] !== "countryInfo" ? "YES — model tried to guess before looking up the country" : "no"})`,
  );
}

main().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────
// Test „posibil problematic": `npm run tema5:agent -- "Care e cea mai
// populată țară din lume?"`. Niciunul dintre cele 3 tool-uri nu știe
// populația vreunei țări. Interesant: spre deosebire de „lucru degeaba"
// clar din celelalte teme, aici răspunsul corect (India sau China, în
// funcție de an) SE AFLĂ chiar în tabelul nostru fals — deci agentul ar
// putea fi tentat să cheme countryInfo("India") sau countryInfo("China")
// ca să "confirme" ceva ce tool-ul nu poate confirma de fapt (populația).
// Rulează și observă dacă modelul cade în capcana asta sau răspunde direct
// din cunoștințele lui generale, fără niciun apel.
// ─────────────────────────────────────────────────────────────────────────
